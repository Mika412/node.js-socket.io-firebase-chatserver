﻿# Chat Server - node.js socket.io firebase

Chat Server built with Firebase and socket.io. Server was built to work with [this](https://github.com/Mika412/Android-socket.io-firebase-chatapp) chat app.

###### Required node modules:
  - Firebase-admin
  - Express
  - Http
  - Socket.io
  
Follow [this](https://firebase.google.com/docs/admin/setup) tutorial on how to get Firebase Credentials. 

Database structure:
```
database{
    users{
        user1-key{
            name,
            email,
            last-login,
            conversations{
		conversation1-key=true,
		conversation2-key=true
	    }
        },
        user2-key{
            ...
        }
    },
    conversations{
        conversation1-key{
            user1-key=true,
            user2-key=true
        },
        conversation2-key{
            ...
        }
    },
    friendlist{
        friends{
            user1-key{
                user2-key=true,
                user3-key=true,
                ...
            },
            user2{
                user1-key=true,
                ....
            }
        },
        pending{
            user1{
                user4-key=true,
                ...
            },
            ...
        }
    },
    messages{
        conversation1{
            messages1{
                senderUID,
                message,
                timestamp
            },
            ...
        },
        conversation2{
            ...
        }
    }
}
```
