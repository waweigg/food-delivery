import 'reflect-metadata';
import 'dotenv/config';
import {createApplication} from './bootstrap.js';
import {config} from './config.js';
createApplication().then(app=>app.listen(config().port,'0.0.0.0')).catch(()=>{console.error('Restaurant service startup failed; check configuration');process.exitCode=1;});
