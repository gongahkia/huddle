/** @jsxImportSource solid-js */
import {createSignal,Show} from 'solid-js';
import {render} from 'solid-js/web';
import {reviewOptions} from '../integration';
import {createHuddle,type HuddleOptions} from '@huddle/browser/solid';
function Review(props: {options: () => HuddleOptions | null}) {createHuddle(props.options); return null;}
function App() {
  const [count,setCount] = createSignal(0), [enabled,setEnabled] = createSignal(true), [environment,setEnvironment] = createSignal('staging'), [release,setRelease] = createSignal('solid-example-v1'), [timeout,setTimeoutMs] = createSignal(15000);
  const base = reviewOptions('solid');
  return <main><h1>Solid integration</h1><section data-huddle-id="solid-counter"><p>Updates: {count()}</p><button onClick={() => setCount(count() + 1)}>Add update</button></section><button onClick={() => setEnabled(!enabled())}>{enabled() ? 'Remove Huddle integration' : 'Mount Huddle integration'}</button><button onClick={() => setRelease('solid-example-v2')}>Change release</button><button onClick={() => setEnvironment(environment() === 'staging' ? 'production' : 'staging')}>Change environment</button><button onClick={() => setTimeoutMs(timeout() === 15000 ? 14000 : 15000)}>Change configuration</button><Show when={enabled()}><Review options={() => base ? {...base,environment: environment(),release: release(),requestTimeoutMs: timeout()} : null}/></Show></main>;
}
render(App,document.getElementById('root')!);
