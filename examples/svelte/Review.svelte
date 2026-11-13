<script lang="ts">
  import {onMount} from 'svelte';
  import {startReview} from '../integration';
  onMount(() => {const review = startReview('svelte'); return () => review?.destroy();});
</script>
