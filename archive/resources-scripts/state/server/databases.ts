import { action, Action } from 'easy-peasy';
import type { Model } from '@definitions';

export interface ServerDatabase extends Model {
    id: string;
    name: string;
    username: string;
    databaseHostId: number;
    connectionString: string;
    allowConnectionsFrom: string;
    password?: string;
}

export interface ServerDatabaseStore {
    data: ServerDatabase[];
    setDatabases: Action<ServerDatabaseStore, ServerDatabase[]>;
    appendDatabase: Action<ServerDatabaseStore, ServerDatabase>;
    removeDatabase: Action<ServerDatabaseStore, string>;
}

const databases: ServerDatabaseStore = {
    data: [],

    setDatabases: action((state, payload) => {
        state.data = payload;
    }),

    appendDatabase: action((state, payload) => {
        if (state.data.find(database => database.id === payload.id)) {
            state.data = state.data.map(database => (database.id === payload.id ? payload : database));
        } else {
            state.data = [...state.data, payload];
        }
    }),

    removeDatabase: action((state, payload) => {
        state.data = [...state.data.filter(database => database.id !== payload)];
    }),
};

export default databases;
