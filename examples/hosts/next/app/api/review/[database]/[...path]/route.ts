import {createNextHandler} from '@huddle/host/next';
import {hostHttpError} from '@huddle/host/http';
import {fixtureOptions} from '../../../../../../fixture-runtime';
export const runtime = 'nodejs';
export async function GET(request: Request,context: {params: Promise<{database:string;path:string[]}>}) {
  try {const {database} = await context.params; const result = await createNextHandler(await fixtureOptions('next',database))(request); result.headers.set('X-Host-Framework','next'); return result;} catch(value) {return hostHttpError(value);}
}
export const POST = GET;
export const PATCH = GET;
