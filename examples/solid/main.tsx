/** @jsxImportSource solid-js */
import {createSignal,onCleanup,onMount,Show} from 'solid-js';
import {render} from 'solid-js/web';
import {startReview} from '../integration';
import type {Huddle} from '@huddle/browser';
function Review() {let review: Huddle | undefined; onMount(() => {review = startReview('solid');}); onCleanup(() => review?.destroy()); return null;}
function App() {
  const [count,setCount] = createSignal(0), [enabled,setEnabled] = createSignal(true);
  return <main><h1>Solid integration</h1><section data-huddle-id="solid-counter"><p>Updates: {count()}</p><button onClick={() => setCount(count() + 1)}>Add update</button></section><button onClick={() => setEnabled(!enabled())}>{enabled() ? 'Remove Huddle integration' : 'Mount Huddle integration'}</button><Show when={enabled()}><Review/></Show></main>;
}
render(App,document.getElementById('root')!);
