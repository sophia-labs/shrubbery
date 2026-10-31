/**
 * The ELK worker: elkjs's own worker script. Loaded inside a Worker, it installs ELK's message protocol on `self`
 * (`self.onmessage = dispatcher.saveDispatch`), which the main thread's `elk-api` speaks. Nothing else runs here.
 */
import 'elkjs/lib/elk-worker.min.js'
