/** @jsxImportSource solid-js */
import {createSignal,Show} from 'solid-js';
import {render} from 'solid-js/web';
import {reviewOptions} from '../integration';
import {createHuddle} from '@huddle/browser/solid';
function Review() {createHuddle(() => reviewOptions('solid')); return null;}
function App() {
  const [count,setCount] = createSignal(0), [enabled,setEnabled] = createSignal(true);
  return <main><h1>Solid integration</h1><section data-huddle-id="solid-counter"><p>Updates: {count()}</p><button onClick={() => setCount(count() + 1)}>Add update</button></section><button onClick={() => setEnabled(!enabled())}>{enabled() ? 'Remove Huddle integration' : 'Mount Huddle integration'}</button><Show when={enabled()}><Review/></Show></main>;
}
render(App,document.getElementById('root')!);
