const path = require('path');
const fs = require('fs');
const electron = require('electron');
const axios = require('axios');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
var server = require('http').Server(app);
var io = require('socket.io')(server);

app.use(bodyParser.json());
const userPath = (electron.app || electron.remote.app).getPath('userData');

let panels = [];
let graphics = [];
let messageHandlers = {};

let registry = {
    registerPanel: (file, name) => {
        panels.push({name, file});
    },
    registerMessageHandler: (message, handler) => {
        messageHandlers[message] = handler;
    },
    registerGraphic: (file, name) => {
        graphics.push({name, file});
    },
    registerConfig: (name, defaultValues) => {
        if(config[name] === undefined){
            config[name] = defaultValues;
        }
    }
}

const sendUpdate = () => {
    io.emit("updateState", compileState());
}

let config = {};
if(!fs.existsSync(path.join(userPath, 'config.json'))){
    fs.writeFileSync(path.join(userPath, 'config.json'), JSON.stringify(config));
}
let data = fs.readFileSync(path.join(userPath, 'config.json'));
config = JSON.parse(data);



let modules = [];
let currentState = {
    macros: {
        recording: false,
        recordedActions: [],
        macros: []
    }
};

let initialState = {};

if(fs.existsSync(path.join(userPath, 'state.json'))){
    initialState =  JSON.parse(fs.readFileSync(path.join(userPath, 'state.json')));
}

function loadModules(){
    if(!fs.existsSync(path.join(userPath, 'modules'))){
        fs.mkdirSync(path.join(userPath, 'modules'));
    }
    fs.readdirSync(path.join(userPath, 'modules')).forEach((folder) => {
        let fPath = path.join(userPath, 'modules', folder);
        if(!fs.lstatSync(fPath).isFile()){
            let newModule = require(fPath);
            newModule.create(registry, app, io, config, initialState[newModule.getName()] ? initialState[newModule.getName()] : undefined, sendUpdate);
            console.log("Loading Module " + newModule.getName());
            modules.push(newModule);
        }
    });
}

function loadMacros(){
    if(!fs.existsSync(path.join(userPath, 'macros'))){
        fs.mkdirSync(path.join(userPath, 'macros'));
    }
    fs.readdirSync(path.join(userPath, 'macros')).forEach((file) => {
        let fileData = fs.readFileSync(path.join(userPath, 'macros', file));
        let macro = JSON.parse(fileData);
        currentState.macros.macros.push(macro);
    });
}
currentState.events = [];
currentState.macros.macros = [];

loadModules();
loadMacros();


// let currentState = {
//     scale: 300,
//     position: "bottom_left",
//     visible: false,
//     backdrop: {
//         visible: true,
//         text: "Starting Soon"
//     },
//     spotify: {
//         song: "",
//         artist: "",
//         volume: 0,
//         token: ""
//     },
//     events: [],
//     recording: false,
//     macros: [],
//     recordedActions: []
// }

var spotifyInterval = -1;

// function spotifyCheck(){
//     spotifyApi.getMyCurrentPlaybackState({
//     })
//     .then(function(data) {
//         let spotify = currentState.spotify;
//         spotify.volume = data.body.device.volume_percent;
//         spotify.song = data.body.item.name;
//         spotify.image = data.body.item.album.images[0].url;
//         let artistList = "";
//         data.body.item.artists.forEach((artist) => {
//             artistList += artist.name + ", ";
//         });
//         spotify.artist = artistList;
//         currentState.spotify = spotify;
//         io.emit('updateState', currentState);
//     }, function(err) {
//         if(err.statusCode === 401){
//             io.emit("spotifyAuth");
//             clearInterval(spotifyInterval);
//         }
//       console.log('Something went wrong!', err);
//     });
// }



// function fade(start, end){
//     let newVol = start > end ? Math.max(end, start - 10) : Math.min(end, start + 10);
//     if(start === end){
//         return;
//     }
//     setTimeout(() => {
//         spotifyApi.setVolume(newVol).then(() => {
//             if(newVol !== end){
//                 fade(newVol, end);
//             }
//             currentState.spotify.volume = newVol;
//         }, () => {

//         });
//     }, 500);
// }

// var lastFollowerCheck = new Date().getTime();

// let followURL = `https://api.twitch.tv/kraken/channels/rushmead/follows?client_id=${config.twitch.client_id}`;
// function getFollowers(){
//     let newFollowers = [];
//     console.log("Checking followers");
//     axios.get(followURL).then((data) => {
//         let actualData = data.data;
//         if(actualData.follows){
//             actualData.follows.forEach((follow) => {
//                 if(+moment(follow.created_at) > lastFollowerCheck){
//                     newFollowers.push(follow);
//                 }
//             })
//             if(newFollowers.length > 0){
//                 newFollowers.forEach((follow) => {
//                     let event = {type: "follow", created_at: follow.created_at, username: follow.user.display_name};
//                     io.emit("newEvent", event);
//                     currentState.events.push(event);
//                 })
//             }
//             lastFollowerCheck = new Date().getTime();
//         }
//     })
// }

// setInterval(getFollowers, 20 * 1000);

function compileState(){
    let state = {...currentState};
    modules.forEach((mModule) => {
        state[mModule.getName()] = mModule.getState();
    })
    return state;
}

function handleAction(data){
    if(typeof data === "object"){
        if(messageHandlers[data.type]){
            messageHandlers[data.type](data.value).then(() => {
                io.emit("updateState", compileState());
            });
        }else if(data.type === "delay"){
            return new Promise((r, _) => setTimeout(r, data.value));
        }
    }
}

let recordedActions = [];

io.on('connection', function (socket) {
    socket.on('ready', (type) => {
        console.log("Client connected with type " +type)
        if(type === "panel"){
            socket.emit('loadPanels', panels);
        }else if(type === "view"){
            socket.emit('loadGraphics', graphics);
        }
    });
    socket.on('sendState', () => {
        console.log("Sending state!");
        socket.emit('updateState', compileState());
    });
    socket.on('doAction', function (data) {
        if(!currentState.macros.recording){
            handleAction(data);
        } else {
            currentState.macros.recordedActions.push(data);
            io.emit('updateState', compileState());
        }
    });
    socket.on('toggleRecord', () => {
        currentState.macros.recording = !currentState.macros.recording;
        if(currentState.macros.recording){
            currentState.macros.recordedActions = [];
        }
        socket.emit('updateState', compileState());
    });
    socket.on('saveRecording', (name) => {
        let macro = {
            name: name,
            actions: currentState.macros.recordedActions
        }
        let normalName =  name.toLowerCase().replace(/\s/g, "_");
        fs.writeFile(`macros/${normalName}.json`, JSON.stringify(macro), () => {
            currentState.macros.macros.push(macro);
            currentState.macros.recordedActions = [];
            socket.emit('updateState', compileState());
        });
    });
    socket.on('clearRecording', () => {
        currentState.macros.recordedActions = [];
        socket.emit('updateState', compileState());
    });
    socket.on('runMacro', async (name) => {
        var macro = currentState.macros.macros.find((mac) => mac.name === name);
        for(var i = 0; i < macro.actions.length; i++){
            await handleAction(macro.actions[i]);
        }
    });
    socket.on('refreshMacros', () => {
        currentState.macros.macros = [];
        loadMacros();
    })
    socket.on('deleteMacro', (name) => {
        console.log("Deleting Macro", name);
        currentState.macros.macros = currentState.macros.macros.filter((macro) => {
            if(macro.name !== name){
                return true;
            }else{
                let normalName =  macro.name.toLowerCase().replace(/\s/g, "_");
                fs.unlinkSync(`macros/${normalName}.json`);
                return false;
            }
        })
        io.emit('updateState', compileState());
    })
});
app.use('/assets', express.static(path.join(__dirname, 'assets')))
app.use('/modules', express.static(path.join(userPath, 'modules')))
app.get('/ws', (req, res) => {
    io.emit(req.query.name);
    res.send({ok: true});
})

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'control.html'));
})
app.get('/view', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
})
server.listen(3001);

module.exports = {
    save: () => {
        fs.writeFileSync(path.join(userPath, 'state.json'), JSON.stringify(compileState()));
    },
    toggleDarkMode: () => {
        io.emit("toggleDarkMode");
    },
    toggleEditMode: () => {
        io.emit("toggleEditMode");
    }
}