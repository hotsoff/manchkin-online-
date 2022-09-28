const user     = require('./user');
const trivia   = require('./trivia-room');
const RoomBase = require('./roombase');

class Lobby extends RoomBase
{
    constructor(ioInstance)
    {
        super(ioInstance);
        this.id = 'lobby';

        // When the trivia module creates a new trivia room,
        // alert the lobby.
        trivia.triviaEventEmitter.on
        (
            trivia.events.NEW_ROOM, (room) =>
            {
                this.sendNewRoom(room);
            }
        );

        // When the trivia module deletes a trivia room,
        // alert the lobby.
        trivia.triviaEventEmitter.on
        (
            trivia.events.DELETE_ROOM, (room) =>
            {
                this.sendDeleteRoom(room);
            }
        );

        // Whenever a room is updated (i.e. player count changes),
        // alert the lobby.
        trivia.triviaEventEmitter.on
        (
            trivia.events.UPDATE_ROOM, (room) =>
            {
                this.sendUpdateRoom(room);
            }
        );
    }

    // Add a user to the lobby, sending them the room list once they join.
    addUser(user)
    {
        super.addUser(user);
        this.sendRoomListToUser(user);
        this.sendEnteredLobby(user);
    }

    removeUser(user)
    {
        super.removeUser(user);
        this.sendLeftLobby(user);
    }

    // Send the room list to the user.
    sendRoomListToUser(user)
    {
        // Create a list of relevant information of each active trivia room.
        let response = [];
        trivia.getRoomIdList().forEach
        (
            id => 
            response.push
            (
                makeRoomInfoObject(trivia.getRoomById(id))
            )
        );
        
        // Send the room list to the user.
        user.socket.emit('room list', response);
    }

    // Tell the users in the lobby that a new room was created.
    sendNewRoom(room)
    {
        this.io.to(this.id).emit('new room', makeRoomInfoObject(room));
    }

    // Tell the users in the lobby that a room was deleted.
    sendDeleteRoom(room)
    {
        this.io.to(this.id).emit('delete room', makeRoomInfoObject(room));
    }

    // Tell users in the lobby that the given room has been updated.
    sendUpdateRoom(room)
    {
        this.io.to(this.id).emit('update room', makeRoomInfoObject(room));
    }

    sendEnteredLobby(user)
    {
        user.socket.emit('entered lobby');
    }

    sendLeftLobby(user)
    {
        user.socket.emit('left lobby');
    }
}

// Make the object that will be sent to the client when they need information
// about the given room.
function makeRoomInfoObject(room)
{
    let result = 
    {
        id          : room.id,
        name        : room.name,
        playerCount : room.users.length,
        categoryName: room.config.category ? room.config.category.name : 'Any',
        difficulty  : room.config.difficulty ? room.config.difficulty : 'Any'
    };

    return result;
}

module.exports = Lobby;