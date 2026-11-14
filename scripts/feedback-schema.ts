import {mkdir,writeFile} from 'node:fs/promises';
import {z} from 'zod';
import {feedbackSnapshotSchema} from '../packages/shared/src/portable';
await mkdir('docs/schema',{recursive: true});
await writeFile('docs/schema/huddle.feedback.v2.schema.json',JSON.stringify(z.toJSONSchema(feedbackSnapshotSchema),null,2) + '\n');
