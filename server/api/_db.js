import { MongoClient } from 'mongodb';

// SECURITY: the connection string must only ever come from the environment.
// (A live Atlas password used to be hardcoded here — rotate that password in
// MongoDB Atlas if it was ever committed or shared.)
const MONGODB_URI = (process.env.MONGODB_URI || '').trim();
const DB_NAME = process.env.MONGODB_DB_NAME || 'patente_bangla';

const options = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
};

let clientPromise;

function connect() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not configured');
  }
  if (!global._mongoClientPromise) {
    const client = new MongoClient(MONGODB_URI, options);
    global._mongoClientPromise = client.connect();
  }
  return global._mongoClientPromise;
}

export async function getDb() {
  const connectedClient = await connect();
  return connectedClient.db(DB_NAME);
}

export async function getCollection(name) {
  const db = await getDb();
  return db.collection(name);
}
