class Module {
    constructor(){
        
    }

    create(registry, app, io, config) {
        return this;
    }

    getDefaultState(){
        return {}
    }

    getState() {
        return {};
    }

    getName() {
        return "";
    }
}

module.exports = Module;