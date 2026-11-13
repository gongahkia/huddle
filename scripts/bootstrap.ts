import {Database} from '../apps/server/src/database';
import {bootstrap} from '../apps/server/src/auth';
import {z} from 'zod';
import {bootstrapPassword} from './password';
const email = z.string().email().parse(process.argv[2]);
const name = z.string().min(1).max(80).parse(process.argv[3] || 'Administrator');
const password = await bootstrapPassword();
const db = new Database(process.env.HUDDLE_DATABASE || '.data/huddle.sqlite');
try {bootstrap(db,email,name,password); console.log('Huddle administrator created. Sign in with your chosen credentials.');} finally {db.close();}
