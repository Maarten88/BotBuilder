﻿import collection = require('../dialogs/DialogCollection');
import session = require('../Session');
import storage = require('../storage/Storage');
import uuid = require('node-uuid');
import readline = require('readline');

export interface ITextBotOptions {
    userStore?: storage.IStorage;
    sessionStore?: storage.IStorage;
    maxSessionAge?: number;
    localizer?: ILocalizer;
    defaultDialogId?: string;
    defaultDialogArgs?: any;
}

export class TextBot extends collection.DialogCollection {
    private options: ITextBotOptions = {
        maxSessionAge: 14400000,    // <-- default max session age of 4 hours
        defaultDialogId: '/'
    };

    constructor(options?: ITextBotOptions) {
        super();
        this.configure(options);
    }

    public configure(options: ITextBotOptions) {
        if (options) {
            for (var key in options) {
                if (options.hasOwnProperty(key)) {
                    (<any>this.options)[key] = (<any>options)[key];
                }
            }
        }
    }

    public beginDialog(address: IBeginDialogAddress, dialogId: string, dialogArgs?: any): void {
        // Validate args
        if (!this.hasDialog(dialogId)) {
            throw new Error('Invalid dialog passed to TextBot.beginDialog().');
        }
        // Dispatch message
        var msg: IMessage = address || {};
        var userId = msg.to ? msg.to.channelId : 'user';
        this.dispatchMessage(userId, msg, null, dialogId, dialogArgs);
    }

    public processMessage(message: IMessage, callback?: (err: Error, reply: IMessage) => void): void {
        this.emit('message', message);
        if (!message.id) {
            message.id = uuid.v1();
        }
        if (!message.from) {
            message.from = { channelId: 'text', address: 'user' };
        }
        this.dispatchMessage(message.from.address, message, callback, this.options.defaultDialogId, this.options.defaultDialogArgs);
    }

    public listenStdin(): void {
        function onMessage(message: IMessage) {
            console.log(message.text);
        }
        this.on('reply', onMessage);
        this.on('send', onMessage);
        this.on('quit', () => {
            rl.close();
            process.exit();
        });
        var rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
        rl.on('line', (line: string) => {
            this.processMessage({ text: line || '' });
        });
    }

    private dispatchMessage(userId: string, message: IMessage, callback: (err: Error, reply: IMessage) => void, dialogId: string, dialogArgs: any): void {
        // Initialize session
        var ses = new session.Session({
            localizer: this.options.localizer,
            dialogs: this,
            dialogId: dialogId,
            dialogArgs: dialogArgs
        });
        ses.on('send', (reply: IMessage) => {
            this.saveData(userId, ses.userData, ses.sessionState, () => {
                // If we have no message text then we're just saving state.
                if (reply && reply.text) {
                    if (callback) {
                        callback(null, reply);
                        callback = null;
                    } else if (message.id || message.conversationId) {
                        reply.from = message.to;
                        reply.to = reply.replyTo || reply.to;
                        reply.conversationId = message.conversationId;
                        reply.language = message.language;
                        this.emit('reply', reply);
                    } else {
                        this.emit('send', reply);
                    }
                }
            });
        });
        ses.on('error', (err: Error) => {
            if (callback) {
                callback(err, null);
                callback = null;
            } else {
                this.emit('error', err, message);
            }
        });
        ses.on('quit', () => {
            this.emit('quit', message);
        });

        // Dispatch message
        this.getData(userId, (err, userData, sessionState) => {
            ses.userData = userData || {};
            ses.dispatch(sessionState, message);
        });
    }

    private getData(userId: string, callback: (err: Error, userData: any, sessionState: ISessionState) => void) {
        // Ensure stores specified
        if (!this.options.userStore) {
            this.options.userStore = new storage.MemoryStorage();
        }
        if (!this.options.sessionStore) {
            this.options.sessionStore = new storage.MemoryStorage();
        }

        // Load data
        var ops = 2;
        var userData: any, sessionState: ISessionState;
        this.options.userStore.get(userId, (err, data) => {
            if (!err) {
                userData = data;
                if (--ops == 0) {
                    callback(null, userData, sessionState);
                }
            } else {
                callback(err, null, null);
            }
        });
        this.options.sessionStore.get(userId, (err: Error, data: ISessionState) => {
            if (!err) {
                if (data && (new Date().getTime() - data.lastAccess) < this.options.maxSessionAge) {
                    sessionState = data;
                }
                if (--ops == 0) {
                    callback(null, userData, sessionState);
                }
            } else {
                callback(err, null, null);
            }
        });
    }

    private saveData(userId: string, userData: any, sessionState: ISessionState, callback: (err: Error) => void) {
        var ops = 2;
        function onComplete(err: Error) {
            if (!err) {
                if (--ops == 0) {
                    callback(null);
                }
            } else {
                callback(err);
            }
        }
        this.options.userStore.save(userId, userData, onComplete);
        this.options.sessionStore.save(userId, sessionState, onComplete);
    }
}