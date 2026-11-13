import '@angular/compiler';
import {Component, OnDestroy, OnInit, signal} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
import {mount, type Huddle} from '@huddle/browser';
class Example implements OnInit, OnDestroy {
 count = signal(0); private review?: Huddle;
 ngOnInit() {const params = new URLSearchParams(location.search), projectId = params.get('project'); if (projectId) this.review = mount({serverUrl: params.get('server') || 'http://localhost:4310',projectId,environment: 'staging',release: 'angular-example-v1'});}
 ngOnDestroy() {this.review?.destroy();}
}
Component({selector: 'huddle-example',standalone: true,template: `<header><strong>Sundown studio / Angular</strong><nav><a href="../html/">HTML example</a><a href="../react/">React example</a></nav></header><main><small>ANGULAR INTEGRATION</small><h1>Different framework.<br>The same conversation.</h1><p>Add ?project=YOUR_PROJECT_ID to mount Huddle.</p><div class="grid"><section class="card" data-huddle-id="angular-counter"><h2>Team activity</h2><p>Updates: {{count()}}</p><button (click)="count.set(count()+1)">Add update</button></section></div></main>`})(Example);
void bootstrapApplication(Example);
