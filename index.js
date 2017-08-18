var admin = require("firebase-admin");
var express = require('express');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);
var port = process.env.PORT || 3000;

var serviceAccount = require("./firebase_key.json"); //Your firebase key

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "YOUR_DATABASE_URL"
});
// As an admin, the app has access to read and write all data, regardless of Security Rules
var db = admin.database();
var usersRef = db.ref("users");
var conversationsRef = db.ref("conversations");
var messagesRef = db.ref("messages");
var friendsRef = db.ref("friendlist/friends");
var pendingFriendRef = db.ref("friendlist/pending");

server.listen(port, function () {
  console.log('Server listening at port %d', port);
});

// Routing
app.use(express.static(__dirname + '/public'));

io.on('connection', function (socket) {
  var addedUser = false;

  //################################ UPDATE TOKEN ######################################
  socket.on('token update', function (uid, token) {
    console.log("User " + uid + " has new token " + token);


    usersRef.child(uid).child("tokens").update({
      [token]: true
    });
  });

  socket.on('token delete', function (uid, token) {
    console.log("User " + uid + " deleted token " + token);

    usersRef.child(uid).child("tokens").child(token).set(null);
  });

  //################################ LOGIN ######################################
  socket.on('login', function (uid, email) {
    console.log("login user " + uid + " " + email);

    var timestamp = new Date().getTime();
    console.log(timestamp);

    usersRef.child(uid).update({
      "last-login": timestamp
    });

    usersRef.child(uid).once("value", snapshot => {
      socket.emit("login response", {
        userId: uid,
        email: email,
        name: snapshot.val().name
      });
    });
  });

  //################################ REGISTER ######################################
  socket.on('register', function (uid, email, name) {
    console.log("Register user " + name + " " + email);

    var timestamp = new Date().getTime();
    console.log(timestamp);

    // Create a new ref and save data to it in one step
    usersRef.child(uid).set({
      name: name,
      email: email,
      "last-login": timestamp
    });

    //tools.register(email, name, function(response){
    socket.emit("register response", {
      userId: uid
    });
    //});
  });

  //################################ CONVERSATIONS ######################################

  //Starting a conversation
  socket.on('start conversation', function (myUID, otherUID, message) {
    var conversationKey = conversationsRef.push({
      [myUID]: true,
      [otherUID]: true
    }).key;

    console.log(myUID + " started conversation " + otherUID);

    usersRef.child(myUID).child("conversations").child(conversationKey).set(true);
    usersRef.child(otherUID).child("conversations").child(conversationKey).set(true);

    console.log(myUID + " sent a message  " + message);
    var timestamp = new Date().getTime();
    messagesRef.child(conversationKey).push({ userUID: myUID, message: message, timestamp: timestamp }).then((snapshot) => {
      var key = snapshot.key;
      messagesRef.child(conversationKey).child(key).once("value").then((snap) => {
        console.log("Shit " + conversationKey);
        socket.emit("start conversation response", {
          conversationID: conversationKey
        });

        //Send message to myself
        var payload = {
          data: {
            type: "newconversation",
            messageUID: snap.key,
            conversationUID: conversationKey,
            user: myUID,
            message: snap.child('message').val(),
            created_at: snap.child('timestamp').val() + ""
          }
        };
        sendFCMMessageUser(myUID, payload);

        usersRef.child(myUID).once("value", snap2 => {
          //Send message to another user
          var payload2 = {
            data: {
              type: "newconversation",
              messageUID: snap.key,
              conversationUID: conversationKey,
              user: myUID,
              name: snap2.val().name,
              message: snap.child('message').val(),
              created_at: snap.child('timestamp').val() + ""
            }
          };
          sendFCMMessageUser(otherUID, payload2);
        });
      });
    });
  });

  //Querying all conversations
  socket.on('query conversations', function (uid) {
    console.log(uid + " queried conversations.");

    usersRef.child(uid).child("conversations").on("value", snapshot => {
      var promises = [];
      var allConversations = [];
      snapshot.forEach(snap => {
        promises.push(conversationsRef.child(snap.key).once('value').then(conversationID => {
          var conversation = [];
          conversationID.forEach(eachUser => {
            if (eachUser.key != uid)
              allConversations.push({ uid: conversationID.key, user: eachUser.key });
          });
        }));
      });
      Promise.all(promises).then(function () {
        var response = { "conversations": allConversations };
        socket.emit("conversations response", response);
        console.log(response);
      });
    });

  });

  //Delete a conversation

  //TODO LATER


  //################################ MESSAGES ######################################

  //Querying all messages
  socket.on('query messages', function (conversationUID) {
    console.log(conversationUID + " queried messages from " + conversationUID);

    messagesRef.child(conversationUID).on("value", snapshot => {
      var promises = [];
      var allMessages = [];

      snapshot.forEach(snap => {
        var message = {
          messageUID: snap.key,
          conversationUID: conversationUID,
          user: snap.child("userUID").val(),
          message: snap.child('message').val(),
          created_at: snap.child('timestamp').val()
        };
        allMessages.push(message);
      });

      Promise.all(promises).then(function () {
        var response = { "messages": allMessages };
        //console.log(response);
        socket.emit("conversation messages", response);
      });
    });
  });

  //Sending a message
  socket.on('send message', function (conversationUID, myUID, message) {
    console.log(myUID + " sent a message  " + message);
    var timestamp = new Date().getTime();
    messagesRef.child(conversationUID).push({ userUID: myUID, message: message, timestamp: timestamp }).then((snapshot) => {
      var key = snapshot.key;
      messagesRef.child(conversationUID).child(key).once("value").then((snap) => {
        
        usersRef.child(myUID).once("value", snap2 => {
          var payload = {
            data: {
              type: "message",
              messageUID: snap.key,
              conversationUID: conversationUID,
              user: snap.child("userUID").val(),
              name: snap2.val().name,
              message: snap.child('message').val(),
              created_at: snap.child('timestamp').val() + ""
            }
          };
          sendFCMMessageConversation(conversationUID, payload);
        });
      });
    });
  });

  function sendFCMMessageConversation(conversationUID, payload) {
    conversationsRef.child(conversationUID).once('value').then(conversationID => {
      conversationID.forEach(eachUser => {
        console.log("user " + eachUser.key);
        usersRef.child(eachUser.key).child("tokens").once("value", snapshot => {
          snapshot.forEach(snap => {
            console.log("Sending to " + snap.key);
            admin.messaging().sendToDevice(snap.key, payload)
              .then(function (response) {
                console.log("Successfully sent message:");
              })
              .catch(function (error) {
                console.log("Error sending message:");
              });
          });
        });
      });
    });
  }

  //################################ FRIENDS ######################################
  socket.on('query friends', function (myUID) {
    console.log(myUID + " queried friendlist.");

    friendsRef.child(myUID).on("value", function (snapshot) {
      var promises = [];
      var friends = [];
      promises.push(snapshot.forEach(friend => {
        promises.push(usersRef.child(friend.key).once("value").then(userData => {
          var user = { uid: userData.key, name: userData.val().name };
          friends.push(user);
        }));
      }));
      Promise.all(promises).then(function () {

        pendingFriendRef.child(myUID).on("value", function (snapshot) {
          var pending = [];
          promises.push(snapshot.forEach(friend => {
            promises.push(usersRef.child(friend.key).once("value").then(userData => {
              var user = { uid: userData.key, name: userData.val().name };
              pending.push(user);
            }));
          }));
          Promise.all(promises).then(function () {
            var response = { "friends": friends, "pending": pending };
            socket.emit("friendlist response", response);
          });
        });
      });
    });
  });

  socket.on('query pending', function (myUID) {
    console.log(myUID + " queried friendlist.");

    pendingFriendRef.child(myUID).on("value", function (snapshot) {
      var promises = [];
      var allFriends = [];
      snapshot.forEach(friend => {
        promises.push(usersRef.child(friend.key).once("value").then(userData => {
          var user = { uid: userData.key, name: userData.val().name };
          allFriends.push(user);
        }));
      });
      Promise.all(promises).then(function () {
        var response = { "pending": allFriends };
        socket.emit("friendlist response", response);
      });
    });
  });

  socket.on('find person', function (myUID, name) {
    console.log(myUID + " searched for " + name);
    usersRef.orderByChild("name").startAt(name).endAt(name + "\uf8ff").once("value", function (snapshot) {

      var allFriends = [];

      var promises = [];
      promises.push(snapshot.forEach(function (data) {
        var pending = false;
        var friends = false;
        if(myUID == data.key)
          return;
        promises.push(friendsRef.child(myUID + "/" + data.key).once("value").then(function (snapshot2) {
          if (snapshot2.val())
            friends = true;
        }), pendingFriendRef.child(myUID + "/" + data.key).once("value").then(function (snapshot2) {
          if (snapshot2.val())
            pending = true;
        }).then(function () {
          var type = "nothing";
          if (pending)
            type = "pending";
          else if (friends)
            type = "friend";
          var user = { uid: data.key, name: data.val().name, type: type };
          allFriends.push(user);
        }));
      }));

      Promise.all(promises).then(function () {
        socket.emit("person response", {
          userList: allFriends
        });
      });
    });

  });

  socket.on('accept friend', function (myUID, otherUID) {
    console.log(myUID + " accepted " + otherUID);

    friendsRef.child(myUID).equalTo(otherUID).once("value", function (snapshot) {
      if (!snapshot.val()) {
        pendingFriendRef.child(myUID).child(otherUID).once("value", snapshot2 => {
          if (snapshot2.val()) {
            pendingFriendRef.child(myUID + "/" + otherUID).set(null);
            friendsRef.child(otherUID + "/" + myUID).set(true);
            friendsRef.child(myUID + "/" + otherUID).set(true);
            var payload = {
              data: {
                type: "friendaccept",
                by: myUID,
                to: otherUID
              }
            };
            sendFCMMessageUser(myUID, payload);

            //Send to other user, otherUID
            usersRef.child(myUID).child("name").once("value", snap => {
              var payload2 = {
                data: {
                  type: "friendaccept",
                  by: myUID,
                  to: otherUID,
                  name: snap.val()
                }
              };
              sendFCMMessageUser(otherUID, payload2);
            });
          }
        });
      }
    });
  });

  //Send a friend request
  socket.on('friend request', function (myUID, otherUID) {
    console.log(myUID + " sent a friend request " + otherUID);
    friendsRef.child(otherUID + "/" + myUID).once("value", function (snapshot) {
      if (!snapshot.val()) {
        pendingFriendRef.child(otherUID + "/" + myUID).once("value", snapshot2 => {
          if (!snapshot2.val()) {
            pendingFriendRef.child(otherUID + "/" + myUID).set(true);
            //Send to myself to confirm
            var payload = {
              data: {
                type: "friendrequest",
                by: myUID,
                to: otherUID
              }
            };
            sendFCMMessageUser(myUID, payload);

            //Send to other user, otherUID
            usersRef.child(myUID).child("name").once("value", snap => {
              var payload2 = {
                data: {
                  type: "friendrequest",
                  by: myUID,
                  to: otherUID,
                  name: snap.val()
                }
              };
              sendFCMMessageUser(otherUID, payload2);
            });
          }
        });
      }
    });
  });


  function sendFCMMessageUser(user, payload) {
    usersRef.child(user).child("tokens").once("value", snapshot => {
      snapshot.forEach(snap => {
        console.log("Sending to " + snap.key);
        admin.messaging().sendToDevice(snap.key, payload)
          .then(function (response) {
            console.log("Successfully sent message");
          })
          .catch(function (error) {
            console.log("Error sending message");
          });
      });
    });
  }

  console.log('user connected ' + socket.id);
  socket.on('disconnect', function () {
    console.log('user disconnected ' + socket.id);
  });


});