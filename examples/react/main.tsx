import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useHuddle} from '@huddle/browser/react';
import {reviewOptions} from '../integration';
function Example() {
 const [count,setCount] = useState(0);
 useHuddle(reviewOptions('react'));
 return <><header><strong>Sundown studio / React</strong><nav><a href="../html/">HTML example</a><a href="../angular/">Angular example</a></nav></header><main><small>REACT INTEGRATION</small><h1>A shared perspective<br/>on a living interface.</h1><p>Add ?project=YOUR_PROJECT_ID to mount Huddle.</p><div className="grid"><section className="card" data-huddle-id="react-counter"><h2>Workspace activity</h2><p>Updates: {count}</p><button onClick={() => setCount(count + 1)}>Add update</button></section><section className="card"><h2>Review together</h2><p>Pin this element, then change the counter.</p></section></div></main></>;
}
createRoot(document.getElementById('root')!).render(<Example/>);
