'use client';
import {useEffect,useState} from 'react';
import {mount} from '@huddle/browser';
export default function Review() {
  const [count,setCount] = useState(0);
  useEffect(() => {
    const params = new URLSearchParams(location.search), projectId = params.get('project'); if (!projectId) return;
    const review = mount({serverUrl: params.get('server') || 'http://localhost:4310',projectId,environment: 'staging',release: 'next-example-v1'});
    return () => review.destroy();
  },[]);
  return <section data-huddle-id="next-counter"><p>Updates: {count}</p><button onClick={() => setCount(count + 1)}>Add update</button></section>;
}
