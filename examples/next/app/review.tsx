'use client';
import {useEffect,useState} from 'react';
import {useHuddle,type HuddleOptions} from '@huddle/browser/react';
import {createLocalOptions} from '@huddle/browser/local';
import {createHttpAdapter} from '@huddle/browser/http';
const adapter = createHttpAdapter();
export default function Review() {
  const [count,setCount] = useState(0);
  const [options,setOptions] = useState<HuddleOptions | null>(null);
  useHuddle(options);
  useEffect(() => {
    const params = new URLSearchParams(location.search), workspace = params.get('workspace'); if(params.get('mode')==='local'){setOptions(createLocalOptions({namespace:'next-example',workspace:workspace||'personal',environment:'staging',release:'next-example-v1'}));return;}if (!workspace) return;
    setOptions({adapter,namespace: 'next-example',workspace,environment: 'staging',release: 'next-example-v1'});
  },[]);
  return <section data-huddle-id="next-counter"><p>Updates: {count}</p><button onClick={() => setCount(count + 1)}>Add update</button></section>;
}
