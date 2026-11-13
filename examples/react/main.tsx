import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useHuddle,type HuddleOptions} from '@huddle/browser/react';
import {reviewOptions} from '../integration';
function Review({options}: {options: HuddleOptions | null}) {useHuddle(options); return null;}
function Example() {
 const [count,setCount] = useState(0), [enabled,setEnabled] = useState(true), [environment,setEnvironment] = useState('staging'), [release,setRelease] = useState('react-example-v1'), [timeout,setTimeoutMs] = useState(15000);
 const base = reviewOptions('react');
 const controls = <><button onClick={() => setEnabled(!enabled)}>{enabled ? 'Remove Huddle integration' : 'Mount Huddle integration'}</button><button onClick={() => setRelease('react-example-v2')}>Change release</button><button onClick={() => setEnvironment(environment === 'staging' ? 'production' : 'staging')}>Change environment</button><button onClick={() => setTimeoutMs(timeout === 15000 ? 14000 : 15000)}>Change configuration</button>{enabled && base && <Review options={{...base,environment,release,requestTimeoutMs: timeout}}/>}</>;
 return <><header><strong>Sundown studio / React</strong><nav><a href="../html/">HTML example</a><a href="../angular/">Angular example</a></nav></header><main><small>REACT INTEGRATION</small><h1>A shared perspective<br/>on a living interface.</h1><p>Add ?project=YOUR_PROJECT_ID to mount Huddle.</p>{controls}<div className="grid"><section className="card" data-huddle-id="react-counter"><h2>Workspace activity</h2><p>Updates: {count}</p><button onClick={() => setCount(count + 1)}>Add update</button></section><section className="card"><h2>Review together</h2><p>Pin this element, then change the counter.</p></section></div></main></>;
}
createRoot(document.getElementById('root')!).render(<Example/>);
