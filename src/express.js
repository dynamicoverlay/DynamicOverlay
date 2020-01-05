const path = require('path');
const fs = require('fs');
const electron = require('electron');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const server = require('http').Server(app);
const io = require('socket.io')(server);

app.use(bodyParser.json());
const userPath = (electron.app || electron.remote.app).getPath('userData');

let panels = [];
let graphics = [];
let messageHandlers = {};
let settingsOptions = {};
let eventListeners = [];

let registry = {
    registerPanel: (file, name) => {
        panels.push({name, file});
    },
    registerMessageHandler: (message, handler) => {
        messageHandlers[message] = handler;
    },
    registerGraphic: (file, name) => {
        let graphic = {name, file};
        graphics.push(graphic);
        let index = graphics.indexOf(graphic);
        config.layers[name] = index;
        registry.registerSettingsOption('core', name + ' layer position', 'TEXT', index, {type: "number"}, (val) => {
            config.layers[name] = Number(val);
            io.emit('updateGraphics', config.layers);
        });
    },
    registerConfig: (name, defaultValues) => {
        if(config[name] === undefined){
            config[name] = defaultValues;
        }
    },
    registerSettingsOption: (moduleName, name, type, defaultValue, options, onChangeHandler) => {
        if(settingsOptions[moduleName] === undefined){
            settingsOptions[moduleName] = [];
        }
        settingsOptions[moduleName].push({
            id: name.toLowerCase().replace(/\s/g, "_"),
            name,
            type,
            defaultValue,
            options,
            onChangeHandler
        });
    },
    updateConfig: (moduleName, newConfig) => {
        config[moduleName] = newConfig;
        emitEvent('configUpdate', config);
    },
    getConfig: (moduleName) => {
        return config[moduleName];
    },
    registerEventListener: (event, handler) => {
        eventListeners.push({event, handler});
    }
}

const emitEvent = (eventName, data) => {
    eventListeners.filter((a) => a.event === eventName).forEach((handler) => {
        handler.handler(data);
    })
} 

const sendUpdate = () => {
    io.emit("updateState", compileState());
}

let config = {
    layers: {},
    xSize: 1920,
    ySize: 1080
};
const debugLog = (...message) => {
    if(config.debug){
        console.log(`[DEBUG]`, ...message);
    }
}
if(!fs.existsSync(path.join(userPath, 'config.json'))){
    fs.writeFileSync(path.join(userPath, 'config.json'), JSON.stringify(config));
}
let data = fs.readFileSync(path.join(userPath, 'config.json'));
data = JSON.parse(data)
config = {...data, ...config}

registry.registerSettingsOption('core', 'Debug Mode', 'CHECKBOX', config.debug, {}, (val) => {
    config.debug = val;
});
registry.registerSettingsOption('core', 'Dark Mode', 'CHECKBOX', config.dark, {}, (val) => {
    config.dark = val;
    io.emit('setDarkMode', val);
});
registry.registerSettingsOption('core', 'X Size', 'TEXT', config.xSize, {type: "number"}, (val) => {
    config.xSize = Number(val);
});
registry.registerSettingsOption('core', 'Y Size', 'TEXT', config.ySize, {type: "number"}, (val) => {
    config.ySize = Number(val);
});
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
    currentState.panels = initialState.panels;
}

if(currentState.panels === undefined){
    currentState.panels = {};
}

function loadModules(){
    if(!fs.existsSync(path.join(userPath, 'modules'))){
        fs.mkdirSync(path.join(userPath, 'modules'));
    }
    fs.readdirSync(path.join(userPath, 'modules')).forEach((folder) => {
        let fPath = path.join(userPath, 'modules', folder);
        if(config.moduleBlacklist && config.moduleBlacklist.indexOf(folder) !== -1){
            return;
        }
        if(!fs.lstatSync(fPath).isFile()){
            let newModule = require(fPath);
            newModule.create(registry, app, io, config, initialState[newModule.getName()] ? initialState[newModule.getName()] : undefined, sendUpdate);
            debugLog("Loading Module " + newModule.getName());
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

io.on('connection', function (socket) {
    socket.on('ready', (type) => {
        debugLog("Client connected with type " +type)
        if(type === "panel"){
            socket.emit('setDarkMode', config.dark);
            let locationPanels = panels.map((panel) => {
                let normalName = panel.name.toLowerCase().replace(/[\s-]/g, "_");
                if(currentState.panels[normalName]){
                    panel.location = currentState.panels[normalName];   
                }else {
                    panel.location = 'startCol';
                }
                return panel;
            })
            socket.emit('loadPanels', locationPanels);
        }else if(type === "view"){
            let layeredGraphics = graphics.map((graphic) => {
                graphic.layer = config.layers[graphic.name];
                return graphic;
            })
            socket.emit('loadGraphics', layeredGraphics);
            socket.emit('setScale', {xSize: config.xSize, ySize: config.ySize});
        }
    });
    socket.on('sendState', () => {
        debugLog("Sending state!");
        socket.emit('updateState', compileState());
    });
    socket.on('sendSettings', () => {
        socket.emit('loadSettings', settingsOptions);
    })
    socket.on('doAction', function (data) {
        if(!currentState.macros.recording){
            handleAction(data);
        } else {
            currentState.macros.recordedActions.push(data);
            io.emit('updateState', compileState());
        }
    });
    socket.on('saveSettings', (settings) => {
        debugLog("Saving Settings", JSON.stringify(settings));
        Object.keys(settings).forEach((mod) => {
            let modSettings = settings[mod];
            Object.keys(modSettings).forEach((id) => {
                let results = settingsOptions[mod].filter((a) => a.id === id);
                if(results.length === 1){
                    results[0].onChangeHandler(modSettings[id]);
                }
            })
        })
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
        fs.writeFile(path.join(userPath, `macros/${normalName}.json`), JSON.stringify(macro), () => {
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
        debugLog("Deleting Macro", name);
        currentState.macros.macros = currentState.macros.macros.filter((macro) => {
            if(macro.name !== name){
                return true;
            }else{
                let normalName =  macro.name.toLowerCase().replace(/\s/g, "_");
                fs.unlinkSync(path.join(userPath, `macros/${normalName}.json`));
                return false;
            }
        })
        io.emit('updateState', compileState());
    })
    socket.on('movePanel', (panelName, newLocation) => {
        currentState.panels[panelName.toLowerCase().replace(/[\s-]/g, "_")] = newLocation;
    })
});

app.post('/macro/:id', async (req, res) => {
    var macro = currentState.macros.macros.find((mac) => mac.name.toLowerCase().replace(/\s/g, "_") === req.params.id);
    for(var i = 0; i < macro.actions.length; i++){
        await handleAction(macro.actions[i]);
    }
    res.json({success: true});
})
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
        fs.writeFileSync(path.join(userPath, 'config.json'), JSON.stringify(config));
    },
    toggleEditMode: () => {
        io.emit("toggleEditMode");
    },
    toggleSettingsMenu: () => {
        io.emit("toggleSettings");
    }
}