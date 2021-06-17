'use strict';

const request = require('request');
var express = require('express');
var app = express();
var https = require('http');
// const https = require('https');
const fs = require('fs');
var xml2js = require('xml2js');
const nodemailer = require('nodemailer');
var cors = require('cors');
var bodyParser = require('body-parser');
var formidable = require('formidable');
var dbConfig = require("./db_sequlize");
const { Session } = require('inspector');
const { date } = require('azure-storage');
const { join } = require('path');
const { setegid } = require('process');
// const io = require('socket.io')

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());
const options = {
    key: fs.readFileSync('privkey.pem'),
    cert: fs.readFileSync('cert.pem')
};

const httpserver = https.createServer(options, app);
const io = require('socket.io')(httpserver, {
    pingInterval: 1000,
    pingTimeout: 3000
});

var flag = [];

var active_session = [];
var buzz_flag = false;
var session = {
    "10": {},
    "20": {},
    "30": {},
    "40": {},
    "50": {},
    "60": {},
    "70": {}
}






app.post('/host', function(req, res, next) {

    //Check for id;
    if (session.hasOwnProperty(req.body.code)) {
        //Check if session already active
        if (active_session.indexOf(req.body.code) == "-1") {
            //Add to active sessions
            active_session.push(req.body.code);
            //Send response
            res.json({ "status": "success" });
        } else {
            //Send response for session already started.
            res.json({ "status": "session_started" });
        }
    } else {
        res.json({ "status": "failed" });
    }

});


app.post('/verify', function(req, res, next) {
    var name = req.body.name;
    var code = req.body.code;
    var team = req.body.id;

    //Check userid
    if (team != "0" && team < 7 && session.hasOwnProperty(code)) {
        //Check for active Session
        if (active_session.indexOf(req.body.code) != "-1") {
            //Check if player already added
            if (session[code].players.indexOf(team) == "-1") {
                //Check if player added earlier
                if (session[code].players_info.hasOwnProperty(team)) {
                    // Update active players
                    session[code].players.push(team);
                    //Update name
                    session[code]["players_info"][team][2] = name;
                    //Send response
                    res.json({ "status": "success" });
                    //Send details to the host
                    io.to(code).emit('add_team', session[code].players_info[team]);
                } else {
                    // Update active players
                    session[code].players.push(team)
                        // Update player info
                    session[code]["players_info"][team] = [team, "Family " + team, name, "0"];
                    //Send response
                    res.json({ "status": "success" });
                    //Send details to the host
                    io.to(code).emit('add_team', [team, "Family " + team, name, "0"]);
                }

            } else {
                res.json({ "status": "Player already added" });
            }

        } else {
            res.json({ "status": "Session not started" });
        }
    } else {
        res.json({ "status": "Wrong id" })
    }
});


// Show details regarding buzzer and score
app.post("/buzzed", function(req, res, next) {
    //Check if the session has been started or not
    if (active_session.indexOf(req.body.code) != "-1") {
        res.json({ "status": "success" })
    } else {
        res.json({ "status": "failed" })
    }
})

app.post('/enable', function(req, res, next) {
    buzz_flag = true;
    console.log("buzzer enabled")
    io.to(req.body.code).emit("status", buzz_flag);
    res.json({ "status": "success" })
});

app.post('/buzz', function(req, res, next) {
    if (buzz_flag == true) {

        var no = req.body.team;
        buzz_flag = false;

        

        io.to(req.body.code).emit("status", buzz_flag);
        if(no != 'cancel'){
            io.to(req.body.code).emit("team", session[req.body.code].players_info[no][1]);
        }
        
    }
})

app.post("/close", function(req, res, next) {

    // io.to(req.body.code).emit("close", "all")
    res.json({ "status": "success" })
})

app.post("/delete_session", function(req, res, next) {
    delete_session(req.body.code);
    io.to(req.body.code).emit("close_host", "now");
    io.to(req.body.code).emit("close", "all");
    io.to(req.body.code).emit("close_score", "close")
    res.json({ "status": "success" });
    console.log(session);

});

app.post("/delete_player", function(req, res, next) {
    let code = req.body.code;
    let team = req.body.team;
    io.to(req.body.code).emit("close", team);
    if (session[code].players_info.hasOwnProperty(team)) {
        del_player(code, team);
        res.json({ "status": "success" })
    } else {
        res.json({ "status": "failed" });
    }

})

app.get("/get_sessions", function(req, res, next) {
    res.json({ "sessions": active_session });
})


app.post("/close_leaderboard", function(req, res, next) {
    io.to(req.body.code).emit("close_leaderboard", "now");
    res.json({ "status": "success" });
})

app.post("/update_score", function(req, res, next) {
    let code = req.body.code;
    let team = req.body.team;
    let score = req.body.score;
    if (session[code].players_info.hasOwnProperty(team)) {
        session[code].players_info[team][3] = score;
        res.json({ "status": 'updated' });
    }
})

app.post("/save_score", function(req, res, next) {
    let score = req.body.score;
    let code = req.body.code;
    let round = req.body.round;

    if (session[code].hasOwnProperty("players_info")) {
        session[code]['round'] = round;
        for (let team in score) {
            session[code].players_info[team][3] = score[team];
        }
        console.log(session[code].players_info);
        save_data(code);
        //
        res.json({ "status": "success" });

    }
})

app.post("/red", function(req, res, next) {

    io.to(req.body.code).emit("redirect", "now");
    res.json({ "status": "success" });
});

app.post("/send_score", function(req, res, next) {
    let code = req.body.code;

    res.json({ "status": "success", "details": session[code].players_info });
})

io.on('connection', (socket) => {

    socket.on('host', (gamecode, day, round) => {
        //Create new room using gamecode
        socket.join(gamecode);
        //Assign a username for the connection
        socket.username = 'host_' + gamecode;
        console.log(socket.username + " connected");
        //Check for already active session
        if (flag.indexOf(gamecode) != "-1") {

            //Send information for already active session
            io.to(gamecode).emit('updated', session[gamecode]);
        } else {
            //Create new session
            create_session(gamecode, day, round);
        }

    });



    socket.on('join', (gamecode, id) => {

        try {
            if (session[gamecode].players_info.hasOwnProperty(id)) {
                console.log(session[gamecode].players.indexOf(id));
                if (session[gamecode].players.indexOf(id) == "-1") {
                    // Update active players
                    session[gamecode].players.push(id);
                }
    
                //Send details to the host
                io.to(gamecode).emit('add_team', session[gamecode].players_info[id]);
            }   
        } catch (error) {
            console.log('error');
            io.to(gamecode).emit('error',"error");
        }

       
        //Join the room
        socket.join(gamecode);
        //Assign a username
        socket.username = 'player_' + gamecode + '_' + id;
        console.log(socket.username + " connected to Socket " + socket.id);
        console.log(session[gamecode]);

    });
    socket.on("connection_info", (gamecode, id) => {
        try {
            if (session[gamecode].players.indexOf(parseInt(id)) != "-1") {
                io.to(gamecode).emit("connection_check" + this.team_id, "connected");
            } else {
                io.to(gamecode).emit("connection_check" + this.team_id, "not_connected");
            }
        } catch (error) {
            console.log('error');
            io.to(gamecode).emit('error',"error");
        }
        
    });

    socket.on('update_name', (no, name, gamecode) => {
        session[gamecode].players_info[no][1] = name;


    });



    socket.on("update", (info, code) => {
        try {
            console.log(info);
        for (let player in info) {
            if (session[code].players_info.hasOwnProperty(player)) {
                session[code]["players_info"][player][3] = info[player];
            }
        }
        console.log(session[code]);
        } catch (error) {
            console.log("error");
        }

        
    });

    socket.on('buzzed', (gamecode, day, round) => {
        //Join the room
        socket.join(gamecode);
        //Assign a username
        console.log("Buzzed joined");
        //console.log(session);
    });

    socket.on('leaderboard', (gamecode, day, round) => {
        //Join the room
        socket.join(gamecode);
        //Assign a username
        console.log("Buzzed joined");
        //console.log(session);
    });

    socket.on('disconnect', function() {
        //Print disconnected information
        var connectionMessage = socket.username + " Disconnected from Socket " + socket.id;
        console.log(connectionMessage);

        if (socket.username) {
            let info = socket.username.split("_");
            console.log(info);
            console.log(active_session.indexOf(info[1]))
            if (active_session.indexOf(info[1]) != "-1") {
                console.log("hello");
                if (info[0] == 'player') {

                    remove_player(info);
                }

            }

        }
    });
});


function create_session(code, day, round) {
    flag.push(code);
    //Set up the object
    session[code] = {
        'players': [],
        'players_info': {

        },
        'day': day,
        'round': round
    };
    //Send session details
    io.emit("new_session", active_session);
}






function save_data(code) {
    let team1 = check_for_name(session[code].players_info["1"])
    let team2 = check_for_name(session[code].players_info["2"])
    let team3 = check_for_name(session[code].players_info["3"])
    let team4 = check_for_name(session[code].players_info["4"])
    let team5 = check_for_name(session[code].players_info["5"])
    let team6 = check_for_name(session[code].players_info["6"])
    let score1 = check_for_score(session[code].players_info["1"])
    let score2 = check_for_score(session[code].players_info["2"])
    let score3 = check_for_score(session[code].players_info["3"])
    let score4 = check_for_score(session[code].players_info["4"])
    let score5 = check_for_score(session[code].players_info["5"])
    let score6 = check_for_score(session[code].players_info["6"])

    var timestamp = new Date().toISOString("en-US", { timeZone: "Asia/Kolkata" })
    var sqlQuery = "insert into [buzzer] values ( '" + code + "' , '" + session[code].day + "' , '" + session[code].round + "' , '" + team1 + "'  , '" + team2 + "'  , '" + team3 + "'   , '" + team4 + "'  , '" + team5 + "'  , '" + team6 + "'  , '" + score1 + "' , '" + score2 + "' , '" + score3 + "' , '" + score4 + "' , '" + score5 + "' , '" + score6 + "' , '" + timestamp + "')"
    console.log(sqlQuery)
    dbConfig.sequelize.query(sqlQuery, { type: dbConfig.sequelize.QueryTypes.INSERT })
        .then(function(data) {

        })
}


function check_for_name(arr) {
    if (arr == undefined) {
        console.log(null)
        return null;
    } else {
        console.log(arr[0] + ' ' + arr[2]);
        return (arr[0] + ' ' + arr[2]);
    }
}

function check_for_score(arr) {
    if (arr == undefined) {
        console.log(null)
        return null;
    } else {
        console.log(arr[3])
        return arr[3];
    }
}


function del_player(code, id) {
    // Check index no
    var no = session[code].players.indexOf(parseInt(id));
    //Delete from array
    session[code].players.splice(no, 1);
    //Delete from the object
    delete session[code].players_info[id];
    //Send the deleted information
    io.to(code).emit('delete', id);
    console.log(session[code].players_info);
    console.log(session)

}

function remove_player(arr) {
    // Check index no
    console.log()
    var no = session[arr[1]].players.indexOf(arr[2]);
    console.log("The no in array is")
    console.log(no);
    if (no != "-1")
    //Delete from array
        session[arr[1]].players.splice(no, 1);
    //Send the remove information
    io.to(arr[1]).emit('delete', arr[2]);
    console.log("Removing player ")
    console.log(session[arr[1]]);

}

function delete_session(code) {
    active_session.splice(active_session.indexOf(code), 1);
    flag.splice(flag.indexOf(code), 1);
    session[code] = "";
}

httpserver.listen(3000, () => {
    console.log('listening on *:3000');
});