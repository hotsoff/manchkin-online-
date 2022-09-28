const trivia = require('./trivia-room');
const axios  = require('axios');

// The list of available categories, as trivia.Category objects.
let categories = [];

// Maps room IDs to session names for the OpenTDB API.
let sessionTokens = {};

// Returns a Promise that resolves when initialization is complete.
// Put any code that should go after this module initializes in the
// 'then' part of the returned Promise.
function init()
{
    // Delete a room's session token when it is destroyed.
    trivia.triviaEventEmitter.on
    (
        trivia.events.DELETE_ROOM,
        (room) => delete sessionTokens[room.id]
    )
    
    return loadCategories();
}

function getTriviaQuestionAsync(room, onComplete, onError)
{
    let url = 'https://opentdb.com/api.php?amount=1';

    if (room.config.hasDifficulty()) url += `&difficulty=${room.config.difficulty}`;
    if (room.config.hasCategory())   url += `&category=${room.config.category.id}`;

    // Make the request.
    //

    if (room.id in sessionTokens)
    {
        // Make the request. If it turns out our session token
        // has expired (e.message === '4'), then make a
        // new request for a token and then another question request.
        let newUrl = url + `&token=${sessionTokens[room.id]}`;
        makeQuestionRequest(newUrl).then(q => onComplete(q))
        .catch
        (
            e => 
            {
                if (e.message === '4')
                {
                    console.log(`Resetting session token for room ${room.id}.`);
                    getTokenThenRequestQuestion(room, url, onComplete, onError);
                }
                else onError(e);
            }
        );
    }
    else
    {
        // Get a session token and THEN make the request.
        console.log('Getting session token...');
        getTokenThenRequestQuestion(room, url, onComplete, onError);
    }
}

// Return a promise that resolves with an array of all of the
// categories provided by the question source. Each category
// is an object with two parameters: id (a number), and name
// (a string).
//
// Example: [ {id: 9, name: "General Knowledge"}, ... ]
function loadCategories()
{ 
    if (categories.length === 0)
    {
        // If the response isn't cached, make a request for the
        // category list.
        return axios.get('https://opentdb.com/api_category.php')
            .then
            (
                response =>
                {
                    categories = response.data.trivia_categories;
                    return categories;
                }
            );
    }
    else
    {
        // ...Otherwise, return the cached response.
        return new Promise
        (
            (resolve, _) => resolve(categories)
        );
    }
}

// Return the Category object with the given ID, or undefined
// if no such category exists.
function getCategoryById(id)
{
    return categories.find(c => c.id === id);
}

// Returns a list of all of the available categories as an array
// of Category objects. Be sure you have called loadCategories()
// first, and that the promise returned by loadCategories()
// has resolved.
function getCategories()
{
    return categories;
}

function getSessionTokenForRoom(room)
{
    let url = '';

    // If there is already a token for this room, generate the URL required to reset
    // the token. Otherwise, request a new token.
    if (room.id in sessionTokens) 
        url = `https://opentdb.com/api_token.php?command=reset&token=${sessionTokens[room.id]}`;
    else 
        url = 'https://opentdb.com/api_token.php?command=request';


    return axios.get(url).then(response => sessionTokens[room.id] = response.data.token);
}

function makeQuestionRequest(url)
{
    return axios.get(url)
    .then
    (
        response =>
        {
            if (response.data.response_code == 4)
            {
                // Need to reset the token.
                throw new Error('4');
            }
            
            response = response.data.results[0];

            // Get the question data we want from the API response.
            let question = response.question;
            let answers  = response.incorrect_answers;
            answers.push(response.correct_answer);

            // Shuffle the answer list so it isn't in the same order each time.
            for (let i = 0; i < answers.length; ++i)
            {
                let tmp           = answers[i];
                let newIndex      = Math.floor(Math.random() * answers.length);

                answers[i]        = answers[newIndex];
                answers[newIndex] = tmp;
            }

            // Find the index of the correct answer in the answer list.
            let correctIndex = answers.findIndex((a) => a === response.correct_answer);

            // Construct the TriviaQuestion object that will represent the question.
            let triviaQuestion            = new trivia.TriviaQuestion(question, answers, correctIndex);
            triviaQuestion.categoryName   = response.category;
            triviaQuestion.difficulty     = response.difficulty;

            return triviaQuestion;
        }
    );
}

function getTokenThenRequestQuestion(room, url, onComplete, onError)
{
    getSessionTokenForRoom(room)
    .then
    (
        t => 
        {
            console.log(`Got session token: '${t}'.`)
            sessionTokens[room.id] = t;
            url += `&token=${t}`;
            makeQuestionRequest(url)
                .then(q => onComplete(q))
                .catch(error => onError(error));
        }
    )
    .catch(error => onError(error));
}

module.exports.getTriviaQuestionAsync = getTriviaQuestionAsync;
module.exports.loadCategories         = loadCategories;
module.exports.getCategories          = getCategories;
module.exports.getCategoryById        = getCategoryById;
module.exports.init                   = init;