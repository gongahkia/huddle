'use client';
import {useEffect,useState} from 'react';
import {useHuddle,type HuddleOptions} from '@huddle/browser/react';
export default function Review() {
  const [count,setCount] = useState(0);
  const [options,setOptions] = useState<HuddleOptions | null>(null);
  useHuddle(options);
  useEffect(() => {
    const params = new URLSearchParams(location.search), projectId = params.get('project'); if (!projectId) return;
    setOptions({serverUrl: params.get('server') || 'http://localhost:4310',projectId,environment: 'staging',release: 'next-example-v1'});
  },[]);
  return <section data-huddle-id="next-counter"><p>Updates: {count}</p><button onClick={() => setCount(count + 1)}>Add update</button></section>;
}
