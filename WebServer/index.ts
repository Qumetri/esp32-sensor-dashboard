import Express = require("express");

const app = Express()
app.use(Express.json())
interface Reading {
    timestamp: number
    temperature: number
    humidity: number
}

const readings: Reading[] = []


app.get("/health", (req, res) => {
    res.send("Meow! I'm healthy and thriving.")
})

app.post("/api/readings", (req, res) => {
    const reading: Reading = {
        timestamp: Date.now(),
        temperature: req.body.temperature,
        humidity: req.body.humidity
    }
    readings.push(reading)
    res.status(201).json(reading)
})

app.get("/api/readings", (req, res) => {
    res.json(readings)
})

app.listen(3001)