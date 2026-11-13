/** @jsxImportSource preact */
import {render} from 'preact';
import {useState} from 'preact/hooks';
import {reviewOptions} from '../integration';
import {useHuddle,type HuddleOptions} from '@huddle/browser/preact';
function Review({options}: {options: HuddleOptions | null}) {useHuddle(options); return null;}
function App() {
  const [count,setCount] = useState(0), [enabled,setEnabled] = useState(true), [environment,setEnvironment] = useState('staging'), [release,setRelease] = useState('preact-example-v1'), [timeout,setTimeoutMs] = useState(15000);
  const base = reviewOptions('preact');
  return <main><h1>Preact integration</h1><section data-huddle-id="preact-counter"><p>Updates: {count}</p><button onClick={() => setCount(count + 1)}>Add update</button></section><button onClick={() => setEnabled(!enabled)}>{enabled ? 'Remove Huddle integration' : 'Mount Huddle integration'}</button><button onClick={() => setRelease('preact-example-v2')}>Change release</button><button onClick={() => setEnvironment(environment === 'staging' ? 'production' : 'staging')}>Change environment</button><button onClick={() => setTimeoutMs(timeout === 15000 ? 14000 : 15000)}>Change configuration</button>{enabled && base && <Review options={{...base,environment,release,requestTimeoutMs: timeout}}/>}</main>;
}
render(<App/>,document.getElementById('root')!);
