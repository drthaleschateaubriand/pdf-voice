import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const packageJson=JSON.parse(read('package.json'));
assert.equal(packageJson.scripts.build,'next build');
assert.equal(packageJson.scripts.start,'next start --hostname 0.0.0.0');

const auth=read('app/paper-cloud.ts');
assert.match(auth,/accounts:signInWithPassword/);
assert.match(auth,/accounts:signUp/);
assert.match(auth,/getCloudSession/);
assert.match(auth,/firestore.googleapis.com/);
assert.match(auth,/firebasestorage.googleapis.com/);
assert.doesNotMatch(auth,/supabase\.co|SUPABASE_KEY|SUPABASE_URL/);

const teacher=read('app/api/teacher-session/route.ts');
assert.match(teacher,/accounts:lookup/);
assert.match(teacher,/process\.env\.OPENAI/);
assert.doesNotMatch(teacher,/cloudflare:workers/);
assert.doesNotMatch(teacher,/SUPABASE/);

const speech=read('app/api/speech/route.ts');
assert.match(speech,/process\.env\[/);
assert.doesNotMatch(speech,/cloudflare:workers/);

const firestoreRules=read('firebase/firestore.rules');
const storageRules=read('firebase/storage.rules');
assert.match(firestoreRules,/request\.auth\.uid == userId/);
assert.match(storageRules,/request\.auth\.uid == userId/);
assert.doesNotMatch(firestoreRules,/if true/);
assert.doesNotMatch(storageRules,/if true/);

console.log('Firebase Apollo 14: static isolation and configuration checks passed.');
