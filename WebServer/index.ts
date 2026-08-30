import Express = require("express");

const app = Express()



app.get("/health", (req, res) => {
    res.send("Meow! I'm healthy and thriving.")
})

app.post("/api/readings", (req, res) => {

})

app.get("/api/readings", (req, res) => {
    res.send("We've got the readings yay")
})

app.listen(3001)