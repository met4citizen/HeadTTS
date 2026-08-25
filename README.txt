
= Development Notes =

huggingface and onnxruntime no longer support intel macbooks. In order for this to run on a macbook, you'd want to change package.json version of the already packaged component:

 node_modules/@huggingface/transformers/package.json

   "dependencies": {
     ...
     "onnxruntime-node": "1.23.2",

Although messy, this solution is acceptable because (1) you will never deploy your local node_modules, and (2) fixing it in a more complicated way may not be worth it. If you only need it to run on your laptop, this is the easiest solution.


