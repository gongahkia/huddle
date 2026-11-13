/** @jsxImportSource preact */
import {render} from 'preact';
import {useState} from 'preact/hooks';
import {reviewOptions} from '../integration';
import {useHuddle} from '@huddle/browser/preact';
function Review() {useHuddle(reviewOptions('preact')); return null;}
function App() {
  const [count,setCount] = useState(0), [enabled,setEnabled] = useState(true);
  return <main><h1>Preact integration</h1><section data-huddle-id="preact-counter"><p>Updates: {count}</p><button onClick={() => setCount(count + 1)}>Add update</button></section><button onClick={() => setEnabled(!enabled)}>{enabled ? 'Remove Huddle integration' : 'Mount Huddle integration'}</button>{enabled && <Review/>}</main>;
}
render(<App/>,document.getElementById('root')!);
