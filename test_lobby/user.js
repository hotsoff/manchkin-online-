const trivia    = require('./trivia-room');
const questions = require('./question-source');

// The list of connected users.
let allUsers = [];
let io = null;

// Requests made by users to join a room before they have a nickname.
let pendingJoinRoomRequests = {};

/* 
    Initialize the User Module.
*/
function init(ioInstance)
{
    io = ioInstance;
}

/*
    A User who is playing a trivia game.
*/
class User {
    /*            
        | socket   | The user's socket; used to communicate with the user.                           |
        | nickname | The name by which the user is known to other players.                           |
        | lobby    | An instance of the lobby to which this user should go when leaving a game room. |
    */
    constructor(socket, nickname, lobby) 
    {
        this.socket      = socket;
        this.nickname    = nickname;
        this.lobby       = lobby;
        this.room        = null;

        // Wait for the user to get a nickname before listening for
        // other events.
        waitForNickname(this);
    }

    // Assign the user to the given room, and set
    // the user's socket to talk to that room.
    // If the given room is null, the user is
    // considered roomless.
    setRoom(room)
    {
        // Don't do anything if the user is being set
        // to the room it's already in.
        if (this.room === room) return;

        // Remove the socket from the current room, if any.
        if (this.room)
            this.socket.leave(this.room.id);
    
        this.room = room;

        // If this user isn't being set to roomless, set the
        // socket to the new room.
        if (room)
            this.socket.join(room.id);
    }

    // Make the user roomless.
    leaveRoom()
    {
        this.setRoom(null);
    }
}

// Initialize a user's socket events.
function initializeUser(user) 
{
    // Add the user to the given room if it exists.
    user.socket.on
    (
        /**
         * 'join room' comes with a single string, the ID of the room to join.
         */
        'join room', (id) =>
        {
            console.log(`${user.nickname} requested to join room ${id}.`);
            let room = trivia.getRoomById(id);
            if (room)
            {
                room.addUser(user);
            }
        }
    );

    // Remove the user from the given room, taking them back to the lobby.
    user.socket.on
    (
        'leave room', () =>
        {
            if (!user.room) return;

            console.log(`${user.nickname} is leaving room ${user.room.id}.`);
            user.lobby.addUser(user);
        }
    );

    // Create a new room and add the user to it.
    user.socket.on
    (
        // 'create room' comes with an object with the given parameters:
        /**
         * {
         *  difficulty      : string,
         *  name:           : string,
         *  categoryId      : number,
         *  maxSeconds      : number,
         *  canSkipQuestions: boolean
         * }
         */
        
        'create room', (roomInfo) =>
        {     
            let config = new trivia.RoomConfiguration
            (
                questions.getCategoryById(roomInfo.categoryId),
                roomInfo.difficulty,
                roomInfo.maxSeconds,
                roomInfo.canSkipQuestions,
                roomInfo.questionCount
            );

            console.log(`${user.nickname} is creating a new room with the following config:`);
            console.log(config);

            let newRoom = trivia.makeNewRoom(io, roomInfo.name, true, config);
            newRoom.addUser(user);
        }
    );

    // Receive a chat message from the user and emit it to everyone
    // in the same room.
    user.socket.on
    (
        'message', (message) =>
        {
            console.log(`${user.nickname}: ${message}`)
            if (message && message.length > 0 && user.room)
            {
                user.room.sendMessage(user, message);
            }
        }
    );

    // When a user requests a list of available categories,
    // send it to them.
    // Categories are sent in the following format:
    /**
     * [
     *  {id: 0, name: 'some category'},
     *  {id: 1, name: 'another category'},
     *  ...
     * ]
     */
    user.socket.on
    (
        'get category list', () =>
        {
            user.socket.emit('category list', questions.getCategories());
        }
    );
}

// Sets the user's socket to wait for the user to select a nickname.
// The socket also starts listening for the disconnect event at this
// point.
function waitForNickname(user)
{
    // Set the user's nickname and add them to the lobby.
    // Only works if the user hasn't set a nickname yet
    // and the provided nickname is valid.
    user.socket.on
    (
        'set nickname', (nickname) =>
        {
            if (user.nickname.length === 0 && isNicknameValid(nickname))
            {
                if (!isNicknameTaken(nickname))
                {
                    user.nickname = nickname;

                    // Stop listening to the version of 'join room' listed below.
                    user.socket.removeAllListeners('join room');

                    initializeUser(user);
                    user.socket.emit('good nickname');

                    if (user.socket.id in pendingJoinRoomRequests)
                    {
                        let room = trivia.getRoomById(pendingJoinRoomRequests[user.socket.id]);
                        if (room) room.addUser(user);
                        else      user.lobby.addUser(user);

                        // Delete the request.
                        delete pendingJoinRoomRequests[user.socket.id];
                    }
                    else user.lobby.addUser(user);

                    console.log("Setting nickname to " + user.nickname + ".");
                }
                else
                {
                    user.socket.emit('nickname taken');
                }
            }
            else
            {
                user.socket.emit('invalid nickname');
            }
        }
    );
    
    // When a user requests to join a room before they have a nickname,
    // remember the request so they can be moved straight into a room
    // rather than going into the lobby.
    user.socket.on
    (
        'join room', (id) =>
        {
            console.log("Remembering that user wants to join " + id + "...");
            pendingJoinRoomRequests[user.socket.id] = id;
        }
    );

    // Remove the user from the user list when they disconnect.
    user.socket.on
    (
        'disconnect', () =>
        {
            console.log(`${user.nickname || '<nameless user>'} disconnected.`);
            allUsers.splice(allUsers.findIndex((u) => user === u), 1);
            delete pendingJoinRoomRequests[user.socket.id];

            // Remove the user from the room they are currently in, if they are
            // in a room at all.
            if (user.room)
            {
                user.room.removeUser(user);
            }
        }
    );
}

function isNicknameValid(nickname)
{
    return nickname.length >= 1 && nickname.length <= 16;
}

function isNicknameTaken(nickname)
{
    return allUsers.find(u => u.nickname.toLowerCase() === nickname.toLowerCase()) != undefined;
}

module.exports.User     = User;
module.exports.allUsers = allUsers;
module.exports.init     = init;