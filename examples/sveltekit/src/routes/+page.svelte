<script lang="ts">
  import {page} from '$app/state';
  import {huddle,type HuddleOptions} from '@huddle/browser/svelte';
  import {createHttpAdapter} from '@huddle/browser/http';
  const adapter = createHttpAdapter();
  let count = $state(0), enabled = $state(true), environment = $state('staging'), release = $state('sveltekit-example-v1');
  const options = $derived<HuddleOptions | null>(page.url.searchParams.get('workspace') && enabled ? {adapter,namespace: 'sveltekit-example',workspace: page.url.searchParams.get('workspace')!,environment,release} : null);
</script>
<main use:huddle={options} data-server-workspace={page.url.searchParams.get('workspace')}><a href="http://localhost:4327/playground/">UI playground</a><h1>SvelteKit server-rendered integration</h1><section data-huddle-id="sveltekit-counter"><p>Updates: {count}</p><button onclick={() => count++}>Add update</button></section><button onclick={() => enabled = !enabled}>{enabled ? 'Remove Huddle integration' : 'Mount Huddle integration'}</button><button onclick={() => release = 'sveltekit-example-v2'}>Change release</button><button onclick={() => environment = environment === 'staging' ? 'production' : 'staging'}>Change environment</button><a href="/other">Next page</a></main>
