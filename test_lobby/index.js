const express    = require('express');
const app        = express();
const http       = require('http').createServer(app);
const io         = require('socket.io')(http);
const user       = require('./user');
const trivia     = require('./trivia-room');
const Lobby      = require('./lobby');
const questions  = require('./question-source');

// Serve static files from the current working directory.
app.use(express.static('.'));

// Initialize the User Module.
user.init(io);

// Initialize the question source module.
questions.init()
.then
(
    _ =>
    {
        console.log("Question categories loaded.");
        let lobby = new Lobby(io);
        
        // Create a basic room.
        let room = trivia.makeNewRoom(io, 'The Any Room', false);
        room.config.canSkipQuestions = true;

        io.on
        (
            'connection', 
            (socket) => 
            {
                let newUser = new user.User(socket, '', lobby);
                user.allUsers.push(newUser);
                newUser.socket.emit('need nickname');
                console.log("A user connected.");
            }
        );
        
        console.log('Trivia server active on port 3000.');
        http.listen(3000);
    }
).catch(error => console.log(error));
