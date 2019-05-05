const path = require('path');
const fs = require('fs');
const axios = require('axios');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const SpotifyWebApi = require('spotify-web-api-node');   
const moment = require('moment'); 
var server = require('http').Server(app);
var io = require('socket.io')(server);

let config = {};
let data = fs.readFileSync('config.json');
config = JSON.parse(data);

var spotifyApi = new SpotifyWebApi({
    clientId: config.spotify.client_id,
    clientSecret: config.spotify.client_secret,
    redirectUri: config.spotify.redirect_uri
});

let currentState = {
    scale: 300,
    position: "bottom_left",
    visible: false,
    backdrop: {
        visible: true,
        text: "Starting Soon"
    },
    spotify: {
        song: "",
        artist: "",
        volume: 0,
        token: ""
    },
    events: [],
    recording: false,
    macros: [],
    recordedActions: []
}

var spotifyInterval = -1;

function spotifyCheck(){
    spotifyApi.getMyCurrentPlaybackState({
    })
    .then(function(data) {
        let spotify = currentState.spotify;
        spotify.volume = data.body.device.volume_percent;
        spotify.song = data.body.item.name;
        spotify.image = data.body.item.album.images[0].url;
        let artistList = "";
        data.body.item.artists.forEach((artist) => {
            artistList += artist.name + ", ";
        });
        spotify.artist = artistList;
        currentState.spotify = spotify;
        io.emit('receiveState', currentState);
    }, function(err) {
        if(err.statusCode === 401){
            io.emit("spotifyAuth");
            clearInterval(spotifyInterval);
        }
      console.log('Something went wrong!', err);
    });
}

if(fs.existsSync('state.json')){
    currentState = JSON.parse(fs.readFileSync('state.json'));
    if(currentState.spotify === undefined){
        currentState.spotify =  {
            song: "",
            artist: "",
            volume: 0,
            token: ""
        };
    }
    if(currentState.spotify !== undefined && currentState.spotify.token !== ""){
        spotifyApi.setAccessToken(currentState.spotify.token);
        spotifyInterval = setInterval(spotifyCheck, 5000);
    }
}
currentState.events = [];
currentState.macros = [];
fs.readdirSync('macros').forEach((file) => {
    let fileData = fs.readFileSync(path.join('macros', file));
    let macro = JSON.parse(fileData);
    currentState.macros.push(macro);
});

function fade(start, end){
    let newVol = start > end ? Math.max(end, start - 10) : Math.min(end, start + 10);
    if(start === end){
        return;
    }
    setTimeout(() => {
        spotifyApi.setVolume(newVol).then(() => {
            if(newVol !== end){
                fade(newVol, end);
            }
            currentState.spotify.volume = newVol;
        }, () => {

        });
    }, 500);
}

var lastFollowerCheck = new Date().getTime();

let followURL = `https://api.twitch.tv/kraken/channels/rushmead/follows?client_id=${config.twitch.client_id}`;
function getFollowers(){
    let newFollowers = [];
    console.log("Checking followers");
    axios.get(followURL).then((data) => {
        let actualData = data.data;
        if(actualData.follows){
            actualData.follows.forEach((follow) => {
                if(+moment(follow.created_at) > lastFollowerCheck){
                    newFollowers.push(follow);
                }
            })
            if(newFollowers.length > 0){
                newFollowers.forEach((follow) => {
                    let event = {type: "follow", created_at: follow.created_at, username: follow.user.display_name};
                    io.emit("newEvent", event);
                    currentState.events.push(event);
                })
            }
            lastFollowerCheck = new Date().getTime();
        }
    })
}

setInterval(getFollowers, 20 * 1000);

function handleAction(data){
    if (typeof data === "string") {
        if(data === "show"){
            currentState.visible = true;
        } else if(data === "hide") {
            currentState.visible = false;
        }
    } else {
        if(data.type === "scaleUp"){
            currentState.scale = data.value;
        }else if(data.type === "moveCamera"){
            currentState.position = data.value;
        }else if(data.type === "backdrop"){
            let backDrop = data.value;
            if (backDrop.type === "slide-in") {
                currentState.backdrop.visible = true;
            } else if (backDrop.type === "slide-out") {
                currentState.backdrop.visible = false;
            } else if (backDrop.type === "update-text") {
                currentState.backdrop.text = backDrop.value;
            }
        }else if(data.type === "delay"){
            return new Promise((r, _) => setTimeout(r, data.value));
        }else if(data.type === "volume"){
            fade(currentState.spotify.volume, data.value);
        }
    }
    io.emit('receiveState', currentState);
    return Promise.resolve()
}

let recordedActions = [];

io.on('connection', function (socket) {
    socket.on('ready', () => {
        socket.emit('receiveState', currentState);
        if(currentState.spotify === undefined || currentState.spotify.token === ""){
            socket.emit("spotifyAuth");
        }
    });
    socket.on('doAction', function (data) {
        if(!currentState.recording){
            handleAction(data);
        } else {
            currentState.recordedActions.push(data);
            io.emit('receiveState', currentState);
        }
    });
    socket.on('record', (recording) => {
        currentState.recording = recording;
        if(recording){
            currentState.recordedActions = [];
        }
        socket.emit('receiveState', currentState);
    });
    socket.on('saveRecording', (name) => {
        let macro = {
            name: name,
            actions: currentState.recordedActions
        }
        let normalName =  name.toLowerCase().replace(/\s/g, "_");
        fs.writeFile(`macros/${normalName}.json`, JSON.stringify(macro), () => {
            currentState.macros.push(macro);
            currentState.recordedActions = [];
            socket.emit('receiveState', currentState);
        });
    });
    socket.on('clearRecording', () => {
        currentState.recordedActions = [];
        socket.emit('receiveState', currentState);
    });
    socket.on('runMacro', async (name) => {
        var macro = currentState.macros.find((mac) => mac.name === name);
        for(var i = 0; i < macro.actions.length; i++){
            await handleAction(macro.actions[i]);
        }
    });
    socket.on('refreshMacros', () => {
        currentState.macros = [];
        fs.readdirSync('macros').forEach((file) => {
            let fileData = fs.readFileSync(path.join('macros', file));
            let macro = JSON.parse(fileData);
            currentState.macros.push(macro);
            socket.emit('receiveState', currentState);
        });
    })
    socket.on('deleteMacro', (name) => {
        console.log("Deleting Macro", name);
        currentState.macros = currentState.macros.filter((macro) => {
            if(macro.name !== name){
                return true;
            }else{
                let normalName =  macro.name.toLowerCase().replace(/\s/g, "_");
                fs.unlinkSync(`macros/${normalName}.json`);
                return false;
            }
        })
        io.emit('receiveState', currentState);
    })
});
app.use(bodyParser.json());
app.get('/ws', (req, res) => {
    io.emit(req.query.name);
    res.send({ok: true});
})
app.get('/spotify/login', (req, res) => {
    var scopes = 'user-modify-playback-state user-read-email user-read-playback-state';
    res.redirect('https://accounts.spotify.com/authorize' +
      '?response_type=token' +
      '&client_id=' + config.spotify.client_id +
      (scopes ? '&scope=' + encodeURIComponent(scopes) : '') +
      '&redirect_uri=' + encodeURIComponent(config.spotify.redirect_uri));
});
app.post('/spotify/update', (req, res) => {
    let token = req.body.data.substring(14, req.body.data.indexOf('&'));
    io.emit('closeSAuth');
    spotifyApi.setAccessToken(token);
    currentState.spotify.token = token;
    if(spotifyInterval !== -1){
        clearInterval(spotifyInterval);
    }
    spotifyInterval = setInterval(spotifyCheck, 5000);
})
app.get('/spotify/redirect', (req, res) => {
    res.send(`<html>
    <body>
    <h1>Updating...</h1>
    <script type="text/javascript">
    fetch('/spotify/update', {method: 'POST', headers: {'Content-Type': 'application/json'},body: JSON.stringify({data: document.location.hash})}).then((res) => res.json()).then(() => {window.open('', '_self', ''); window.close();})
</script>
    </body>
    </html>`);
})

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'control.html'));
})
app.get('/view', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
})
server.listen(3000);

module.exports = {
    save: () => {
        fs.writeFileSync('state.json', JSON.stringify(currentState));
    },
    toggleDarkMode: () => {
        io.emit("toggleDarkMode");
    },
    toggleEditMode: () => {
        io.emit("toggleEditMode");
    }
}