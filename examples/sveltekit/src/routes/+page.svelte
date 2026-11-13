<script lang="ts">
  import {page} from '$app/state';
  import {huddle,type HuddleOptions} from '@huddle/browser/svelte';
  let count = $state(0), enabled = $state(true), environment = $state('staging'), release = $state('sveltekit-example-v1');
  const options = $derived<HuddleOptions | null>(page.url.searchParams.get('project') && enabled ? {serverUrl: page.url.searchParams.get('server') || 'http://localhost:4310',projectId: page.url.searchParams.get('project')!,environment,release} : null);
</script>
<main use:huddle={options} data-server-project={page.url.searchParams.get('project')}><h1>SvelteKit server-rendered integration</h1><section data-huddle-id="sveltekit-counter"><p>Updates: {count}</p><button onclick={() => count++}>Add update</button></section><button onclick={() => enabled = !enabled}>{enabled ? 'Remove Huddle integration' : 'Mount Huddle integration'}</button><button onclick={() => release = 'sveltekit-example-v2'}>Change release</button><button onclick={() => environment = environment === 'staging' ? 'production' : 'staging'}>Change environment</button><a href="/other">Next page</a></main>
