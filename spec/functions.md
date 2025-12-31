# functions
(this spec is under construction. leave it now)

## summary
"function" consists of the following parts:
- function node
  - make a instance of a function
- func-def-in/out node
  - define function by enclosing the nodes between func-def-in node and func-def-out node.

## purpose
- The users define graphs the user often use as functions and the users use them in the other graphs to make it structured and easier to understand.

## UI
- func-def-in node
  - attributes:
    - socket list: list
      - socket items:
        - socket name: string
          - default value: in [N]
            - [N] is the item index
  - input sockets: none
  - output sockets:
    - (socket in the socket list)
- func-def-out node
  - attributes:
    - socket list: list
      - socket items:
        - socket name: string
          - default value: out [N]
            - [N] is the item index
  - input sockets:
    - (socket in the socket list)
  - output sockets: none
- function node
  - status lamp:
    - layout: [circle] [caption]
    - circle:
      - border color: gray
      - fill color:
        - idle state: dark gray
        - loading state: yellow
        - working state: green
        - is there is error: red
    - caption:
      - idle state: idle
      - loading state: loading in nostr...
      - working state: working
      - if there is error: (short error message)
        
  - attributes:
    - function path: string
      - default value: empty
  - input sockets : (input socket of the function defined by the function path)
  - output sockets: (input socket of the function defined by the function path)

## behaviors
### function node
- on load the main graph
  - if there is the function node in it
  - start function analysis
- on blur after change of the attribute of function path:
  - start function analysis

- on function analysis
  - clear the function analysis tree
  - for each function nodes:
    - if the function path is empty:
    - if the function path is not empty:
      - load the function graph (hereafter referred to as "the function graph")
      - make the input sockets defined by the func-def-in node of the function graph
      - make the output sockets defined by the func-def-out node of the function graph
      - if there is no error, turn the status working

- on load the function graph
  - search graph with the path "mojimoji/graphs/[path]" in #d tag with kind:30078 in nostr
    - with the app users's kind:10002 relay list in the cache
  - if the graph found in nostr:
    - load the json and store as a function definition
    - find the function nodes in the graphs and do follows with each nodes:
      - if the function path is empty:
        - turn the status of the function node error (message="not defined")
      - if the function path is not empty:
        - check the function ancestors of the node in the analysis tree:
          - if there are infinite recursive loops:
            - turn the status of the function node error (message="infinite call")
          - there is no infinite recursive loop:
            - load the function graph recursively
    
- on wiring observable stream with function node
  - make an instance of all the nodes and the pipes in the function definition recursively

- on wiring observable stream with func-def-in node
  - connect pipes from the input socket of the function node to the output socket of the func-def-in node.

- on wiring observable stream with func-def-out node
  - connect pipes from the output socket of the function node to the input socket of the func-def-out node.


