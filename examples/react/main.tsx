import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {mount} from '@huddle/browser';
function Example() {
 const [count,setCount] = useState(0); const params = new URLSearchParams(location.search);
 useEffect(() => {const projectId = params.get('project'); if (!projectId) return; const review = mount({serverUrl: params.get('server') || 'http://localhost:4310',projectId,environment: 'staging',release: 'react-example-v1'}); return () => review.destroy();},[]);
 return <><header><strong>Sundown studio / React</strong><nav><a href="../html/">HTML example</a><a href="../angular/">Angular example</a></nav></header><main><small>REACT INTEGRATION</small><h1>A shared perspective<br/>on a living interface.</h1><p>Add ?project=YOUR_PROJECT_ID to mount Huddle.</p><div className="grid"><section className="card" data-huddle-id="react-counter"><h2>Workspace activity</h2><p>Updates: {count}</p><button onClick={() => setCount(count + 1)}>Add update</button></section><section className="card"><h2>Review together</h2><p>Pin this element, then change the counter.</p></section></div></main></>;
}
createRoot(document.getElementById('root')!).render(<Example/>);
