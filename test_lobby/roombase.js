class RoomBase
{
    constructor(ioInstance)
    {
        this.id    = '';
        this.users = [];
        this.io    = ioInstance;
    }

    // Add a user to the room. Sets the user's room to this
    // room and alerts everyone in the room that they joined.
    //
    // Does nothing if the given user is already in this room.
    addUser(user)
    {
        // If the user is already in this room, don't do anything.
        if (this.isUserInRoom(user)) return;
        
        // Remove the user from whatever room they were in before.
        if (user.room)
            user.room.removeUser(user);

        // Add the user to THIS room.
        this.users.push(user);
        user.setRoom(this);
        this.sendUserJoined(user);
        
        this.sendUserList(user);
    }

    // Remove a user from the room.
    removeUser(user)
    {
        let userIndex = this.users.findIndex((u) => u === user);
        this.users.splice(userIndex, 1);

        // Send a message to the room saying that this user left
        // the room.
        user.leaveRoom();
        this.sendUserLeft(user);
    }

    // Get this room's unique ID.
    getId() { return this.id; }
    
    // Notify all users in the room that the given user has joined.
    sendUserJoined(user)
    {
        this.io.to(this.id).emit('user joined', user.nickname);
    }

    // Notify all users in the room that the given user has left.
    sendUserLeft(user)
    {
        this.io.to(this.id).emit('user left', user.nickname);
    }

    // Send the user list to the given user.
    sendUserList(user)
    {
        let userList = [];
        this.users.forEach((u) => userList.push(u.nickname));
        user.socket.emit('user list', userList);
    }

    // Send a message from the given user to everyone in the room.
    sendMessage(user, message)
    {
        this.io.to(this.id).emit('message', {nickname: user.nickname, message: message});
    }

    // Returns true if the given user is in this room,
    // false otherwise.
    isUserInRoom(user)
    {
        return this.users.findIndex((u) => u === user) != -1;
    }
}

module.exports = RoomBase;