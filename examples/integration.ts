import type {HuddleOptions} from '@huddle/browser';
import {createLocalOptions} from '@huddle/browser/local';
import {createHttpAdapter} from '@huddle/browser/http';
const adapter = createHttpAdapter(),local=new Map<string,HuddleOptions>();
export function reviewOptions(framework: string): HuddleOptions | null {
  const params=new URLSearchParams(location.search),workspace=params.get('workspace');
  if(params.get('mode')==='local'){const key=framework+':'+(workspace||'personal');if(!local.has(key))local.set(key,createLocalOptions({namespace:'huddle-local-'+framework,workspace:workspace||'personal',environment:'staging',release:`${framework}-example-v2`}));return local.get(key)!;}
  return workspace ? {adapter,namespace: 'huddle-examples',workspace,environment: 'staging',release: `${framework}-example-v2`} : null;
}
