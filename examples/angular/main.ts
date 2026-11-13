import '@angular/compiler';
import {Component,signal,type ApplicationRef} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
import {injectHuddle} from '@huddle/browser/angular';
import {reviewOptions} from '../integration';
class Example {
 count = signal(0); environment = signal('staging'); release = signal('angular-example-v1'); timeout = signal(15000);
 review = injectHuddle(() => {const base = reviewOptions('angular'); return base ? {...base,environment: this.environment(),release: this.release(),requestTimeoutMs: this.timeout()} : null;});
}
Component({selector: 'huddle-example',standalone: true,template: `<header><strong>Sundown studio / Angular</strong><nav><a href="../html/">HTML example</a><a href="../react/">React example</a></nav></header><main><small>ANGULAR INTEGRATION</small><h1>Different framework.<br>The same conversation.</h1><p>Add ?project=YOUR_PROJECT_ID to mount Huddle.</p><button (click)="release.set('angular-example-v2')">Change release</button><button (click)="environment.set(environment() === 'staging' ? 'production' : 'staging')">Change environment</button><button (click)="timeout.set(timeout() === 15000 ? 14000 : 15000)">Change configuration</button><div class="grid"><section class="card" data-huddle-id="angular-counter"><h2>Team activity</h2><p>Updates: {{count()}}</p><button (click)="count.set(count()+1)">Add update</button></section></div></main>`})(Example);
let application: ApplicationRef | null = null;
const toggle = document.createElement('button'); toggle.textContent = 'Remove Huddle integration'; toggle.disabled = true; document.body.append(toggle);
void bootstrapApplication(Example).then(value => {application = value; toggle.disabled = false;});
toggle.addEventListener('click',() => {
 if (application) {application.destroy(); application = null; toggle.textContent = 'Mount Huddle integration';}
 else {toggle.disabled = true; if (!document.querySelector('huddle-example')) document.body.prepend(document.createElement('huddle-example')); void bootstrapApplication(Example).then(value => {application = value; toggle.textContent = 'Remove Huddle integration'; toggle.disabled = false;});}
});
