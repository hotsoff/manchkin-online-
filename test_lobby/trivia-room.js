const questionSource = require('./question-source');
const RoomBase       = require('./roombase');
const EventEmitter   = require('events');

// A map of all of the active rooms.
let rooms = {};

// An EventEmitter that other modules can subscribe to
// in order to receive events about room creation,
// deletion, etc.
class TriviaEventEmitter extends EventEmitter {}
const triviaEventEmitter = new TriviaEventEmitter();

// Trivia room event names
const events = 
{
    NEW_ROOM   : 'newRoom',    // Args: the room that was created
    DELETE_ROOM: 'deleteRoom', // Args: the room that was deleted
    UPDATE_ROOM: 'updateRoom'  // Args: the room that was updated
};

// The different levels of difficulty.
const difficulty =
{
    EASY  : 'easy',
    MEDIUM: 'medium',
    HARD  : 'hard'
};

const answerResult = 
{
    INCORRECT: 0,
    CORRECT  : 1,
    SKIPPED  : 2
};

// Represents a trivia question.
class TriviaQuestion 
{
    constructor(question, answers, correctAnswerIndex) 
    {
        this.question           = question;
        this.answers            = answers;
        this.correctAnswerIndex = correctAnswerIndex;
        this.categoryName       = '';
        this.difficulty         = difficulty.MEDIUM;
    }

    getPointValue()
    {
        switch (this.difficulty)
        {
            case difficulty.EASY  : return 10;
            case difficulty.MEDIUM: return 25;
            case difficulty.HARD  : return 50;
            default               : return 0;
        }
    }
}

/*
    Represents a trivia category.
*/
class Category
{
    constructor(id = 0, name = '')
    {
        this.id   = id;
        this.name = name;
    }
}

/*
    The stats of a given user, like points, number
    of questions right/wrong, etc.
*/
class UserStatistics
{
    constructor(points = 0, numCorrect = 0, numWrong = 0)
    {
        this.points              = points;
        this.pointsChange        = 0;
        this.questionsRight      = numCorrect;
        this.questionsWrong      = numWrong;
        this.selectedAnswerIndex = -1; // -1 means no answer selected
    }
}

/*
    The rules a particular room abides by.
*/
class RoomConfiguration
{
    constructor(category = null, difficulty = null, maxSeconds = 30, canSkipQuestions = false, numQuestions = 0)
    {
        this.category         = category;   // null if no category
        this.difficulty       = difficulty; // easy, medium, hard, or null
        this.maxSeconds       = maxSeconds;
        this.canSkipQuestions = canSkipQuestions;
        this.questionCount    = numQuestions; // 0 means unlimited questions; the game never ends
    }

    // Returns true if the room is set to a specific category, or false
    // if the room is for any category.
    hasCategory()
    {
        return this.category != null;
    }

    // Returns true if the room is set to a specific difficulty (easy, medium,
    // or hard), or false if the room is for any difficulty.
    hasDifficulty()
    {
        return this.difficulty != null;
    }
}

// Represents a room in which trivia players play a 
// session. Each room represents a separate game of
// trivia.
class TriviaRoom extends RoomBase
{
    constructor(ioInstance, name, deleteOnLastUser = true, config)
    {
        super(ioInstance);

        this.id                = generateId();
        this.name              = name;
        this.timerId           = -1;
        this.secondsLeft       = config.maxSeconds;
        this.currentQuestion   = null;
        this.deleteOnLastUser  = deleteOnLastUser;
        this.config            = config;
        this.acceptAnswers     = true;
        this.questionsAnswered = 0;

        // Maps usernames to the stats each user has.
        this.userStats = {};

        this.requestNewQuestion();
    }

    // Add a user to the room.
    addUser(user)
    {
        super.addUser(user);
        this.userStats[user.nickname] = new UserStatistics();

        // Called when the user selects an answer.
        /**
         * 'answer' comes with a number, the index of the answer the
         * user selected.
         */
        user.socket.on
        (
            'answer', (answerNumber) => 
            {
                let stats = this.userStats[user.nickname] || null;
                if (stats && stats.selectedAnswerIndex === -1 && this.acceptAnswers) 
                {
                    stats.selectedAnswerIndex = answerNumber;
                }
            }
        );
        
        this.sendEnteredGameRoom(user);
        this.sendUserStatsToAll(user);

        if (!this.isGameOver())
            this.sendCurrentQuestionToOne(user);
        else
            this.sendGameOverToOne(user);

        triviaEventEmitter.emit(events.UPDATE_ROOM, this);
    }

    // Remove the given user from the room.
    removeUser(user)
    {
        super.removeUser(user);
        delete this.userStats[user.nickname];

        // Stop listening for answer events from this user.
        user.socket.removeAllListeners('answer');

        this.sendLeftGameRoom(user);
        this.sendUserStatsToAll(user);

        // If this was the last user, remove this room
        // from the room list and stop the timer.
        if (this.users.length === 0 && this.deleteOnLastUser)
        {
            deleteRoom(this);
            console.log(`Deleted room ${this.id}.`);
        }
        else
        {
            triviaEventEmitter.emit(events.UPDATE_ROOM, this);
        }
    }

    // Tell each connected user if their answer was right or wrong
    // and reset their selected answer. Also compiles and sends
    // the new user stats.
    sendAnswerResultsAndResetSelections()
    {
        if (this.currentQuestion)
        {
            this.users.forEach
            (
                (user) => 
                {
                    let stats = this.userStats[user.nickname];
                    let result;

                    if (stats.selectedAnswerIndex === -1 && this.config.canSkipQuestions)
                    {
                        // Set the answer to skipped if they made no selection and
                        // the room is configured to allow skips.
                        result = answerResult.SKIPPED;
                        stats.pointsChange = 0;
                        ++stats.questionsWrong;
                    }
                    else
                    {
                        // Otherwise, mark the answer as right or wrong.
                        result = stats.selectedAnswerIndex === this.currentQuestion.correctAnswerIndex 
                            ? answerResult.CORRECT 
                            : answerResult.INCORRECT;
                        
                        stats.pointsChange = result === answerResult.CORRECT 
                            ? this.currentQuestion.getPointValue() 
                            : -this.currentQuestion.getPointValue();

                        result === answerResult.CORRECT 
                            ? ++stats.questionsRight 
                            : ++stats.questionsWrong;
                    }

                    // Update points and send the result.
                    stats.points += stats.pointsChange;
                    if (stats.points < 0) stats.points = 0;
                    user.socket.emit('answer result', result)
                }
            );

            // Notify users of the changes.
            this.sendUserStatsToAll();

            // Reset answer selections.
            for (let u in this.userStats) this.userStats[u].selectedAnswerIndex = -1;
        }
    }

    // Tell each connected user how many seconds are left until the
    // current question ends.
    sendSecondsLeft()
    {
        this.io.to(this.id).emit('seconds left', this.secondsLeft);
    }

    // Send the current question to a specific user.
    sendCurrentQuestionToOne(user)
    {
        if (this.currentQuestion)
        {
            user.socket.emit
            (
                'set question', 
                {
                    ...this.currentQuestion,
                    questionNumber: this.questionsAnswered + 1, 
                    questionCount: this.config.questionCount
                }
            );
        }
    }

    // Send the current question to everyone in the lobby.
    sendCurrentQuestionToAll()
    {
        if (this.currentQuestion)
        {
            this.io.to(this.id).emit
            (
                'set question', 
                {
                    ...this.currentQuestion, 
                    questionNumber: this.questionsAnswered + 1, 
                    questionCount: this.config.questionCount
                }
            );
        }
    }

    // Tell the given user they have entered this room.
    sendEnteredGameRoom(user)
    {
        user.socket.emit('entered game room', this.id);
    }

    // Tell the given user they have left this room.
    sendLeftGameRoom(user)
    {
        user.socket.emit('left game room');
    }

    // Notify all users in the room of point total changes for each user.
    // For example, if everyone now has 100 points, that change would be reflected
    // here.
    sendUserStatsToAll()
    {
        let updates = this.getUserStats();
        this.io.to(this.id).emit('set user stats', updates);
    }

    // Send the point totals to a specific user.
    sendUserStatsToOne(user)
    {
        let updates = this.getUserStats();
        user.socket.emit('set user stats', updates);
    }

    // Compile the stats of all the users.
    getUserStats()
    {
        let updates = [];
        this.users.forEach
        (
            u => 
            updates.push
            (
                {
                    nickname: u.nickname,
                    ...this.userStats[u.nickname]
                }
            )
        );

        return updates;
    }

    // Set the current question.
    setNewQuestion(question) 
    {
        this.currentQuestion = question;
        this.secondsLeft     = this.config.maxSeconds;

        this.io.to(this.id).emit('seconds left', --this.secondsLeft);
        this.sendCurrentQuestionToAll();
    }

    // Request a new question from the question source.
    // Once a question is available, this method calls
    // setNewQuestion() to actually assign the new question.
    requestNewQuestion()
    {
        questionSource.getTriviaQuestionAsync
        (
            this,
            (q) => 
            {
                this.acceptAnswers = true;
                this.setNewQuestion(q);
                this.timerId = setTimeout(timer, 1000, this);
            },
            (e) =>
            {
                console.log(`Question retrieval error. Trying again in 5 seconds. Error: ${e}`);
                setTimeout(this.requestNewQuestion.bind(this), 5000);
            }
        );
    }

    // Send the game over signal, and the final user stats, to all
    // users.
    sendGameOverToAll()
    {
        let stats = this.getUserStats();
        stats = stats.sort(compareStats);
        this.io.to(this.id).emit('game over', stats);
    }

    sendGameOverToOne(user)
    {
        let stats = this.getUserStats();
        stats = stats.sort(compareStats);
        user.socket.emit('game over', stats);
    }

    isGameOver()
    {
        return this.questionsAnswered === this.config.questionCount && this.config.questionCount != 0;
    }
}

// Remove the given room from the room list.
function deleteRoom(room)
{
    if (room && room.id in rooms)
    {
        clearTimeout(room.timerId);
        room.timerId = -1;
        delete rooms[room.id];
        triviaEventEmitter.emit(events.DELETE_ROOM, room);
    }
}

// Randomly generate a 5-character string that represents a room.
// Collisions aren't checked for - that could never happen, right???!!
function generateId() 
{
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let   id       = '';

    for (let i = 0; i < 5; ++i) 
        id += alphabet.charAt(Math.floor(Math.random() * alphabet.length));

    return id;
}

// Make a new trivia room. ioInstance is the socket.io handle,
// and is needed by the room to send and receive messages.
function makeNewRoom(ioInstance, name, deleteOnLastUser = true, config = null)
{
    // Default config
    if (!config)
        config = new RoomConfiguration();

    let room = new TriviaRoom(ioInstance, name, deleteOnLastUser, config);

    rooms[room.getId()] = room;

    triviaEventEmitter.emit(events.NEW_ROOM, room);
    return room;
}

// Return the room with the given id, or null if no such room
// exists.
function getRoomById(id)
{
    if (id in rooms) return rooms[id];
    else             return null;
}

// Return an array of the IDs of all of the currently active rooms.
function getRoomIdList()
{
    return Object.keys(rooms);
}

// Decrement the second count and set a new trivia question
// when the timer runs out.
function timer(room)
{
    if (room.secondsLeft === 0) 
    {
        ++room.questionsAnswered;
        room.acceptAnswers = false;

        room.io.to(room.id).emit('end question');
        room.sendAnswerResultsAndResetSelections();

        if (!room.isGameOver())
            setTimeout(() => room.requestNewQuestion(), 5000);
        else
        {
            room.sendGameOverToAll();
            
            // Remove this room from the listing
            if (room.deleteOnLastUser)
                deleteRoom(room);
        }
    }
    else 
    {
        room.io.to(room.id).emit('seconds left', --room.secondsLeft);
        room.timerId = setTimeout(timer, 1000, room);
    }
}

function compareStats(a, b)
{
    if      (a.points > b.points) return -1;
    else if (a.points < b.points) return  1;
    else
    {
        let aQCount = a.questionsRight + a.questionsWrong;
        let bQCount = b.questionsRight + b.questionsWrong;

        let aRatio  = a.questionsRight / aQCount;
        let bRatio  = b.questionsRight / bQCount;

        if      (aRatio > bRatio) return -1;
        else if (aRatio < bRatio) return 1;
        else                      return 0;
    }
}

// Export the trivia API.
//

module.exports.TriviaRoom         = TriviaRoom;
module.exports.TriviaQuestion     = TriviaQuestion;
module.exports.RoomConfiguration  = RoomConfiguration;
module.exports.makeNewRoom        = makeNewRoom;
module.exports.getRoomById        = getRoomById;
module.exports.getRoomIdList      = getRoomIdList;
module.exports.triviaEventEmitter = triviaEventEmitter;
module.exports.events             = events;
module.exports.difficulty         = difficulty;