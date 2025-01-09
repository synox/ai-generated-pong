const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// Serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Keep track of connected players
const players = new Set();
let waitingPlayer = null;

// AI WebSocket simulation
class AIWebSocket {
    constructor(humanWs) {
        this.humanWs = humanWs;
        this.opponent = humanWs;
        humanWs.opponent = this;
        this.lastPaddlePos = JSON.stringify({ y: 160 });
        this.difficulty = 0.85; // AI skill level (0-1)
        this.reactionDelay = 2; // Frames of delay in AI reactions
        this.lastBallPos = null;
        this.predictedY = null;
        
        // Initialize AI paddle position
        this.humanWs.send(JSON.stringify({
            type: 'paddleMove',
            side: 'right',
            y: 160
        }));
    }

    send(message) {
        const data = JSON.parse(message);
        if (data.type === 'gameState') {
            const ballX = data.ball.x;
            const ballY = data.ball.y;
            const ballDx = data.ball.dx;
            const ballDy = data.ball.dy;
            const paddleY = this.calculateAIMove(ballX, ballY, ballDx, ballDy);
            
            this.humanWs.send(JSON.stringify({
                type: 'paddleMove',
                side: 'right',
                y: paddleY
            }));
        }
    }

    calculateAIMove(ballX, ballY, ballDx, ballDy) {
        const CANVAS_WIDTH = 800;
        const CANVAS_HEIGHT = 400;
        const PADDLE_HEIGHT = 80;
        
        // Only predict when ball is moving towards AI
        if (ballDx > 0) {
            // Predict ball position at paddle's x position
            const timeToIntercept = (CANVAS_WIDTH - 20 - ballX) / ballDx;
            let predictedY = ballY + (ballDy * timeToIntercept);
            
            // Account for bounces
            while (predictedY < 0 || predictedY > CANVAS_HEIGHT) {
                if (predictedY < 0) {
                    predictedY = -predictedY;
                }
                if (predictedY > CANVAS_HEIGHT) {
                    predictedY = 2 * CANVAS_HEIGHT - predictedY;
                }
            }
            
            this.predictedY = predictedY;
        }
        
        // Get current paddle position
        const currentY = JSON.parse(this.lastPaddlePos).y;
        
        // If we have a prediction, move towards it
        if (this.predictedY !== null) {
            // Add some intentional error based on difficulty
            const errorMargin = (1 - this.difficulty) * PADDLE_HEIGHT;
            const targetY = this.predictedY - (PADDLE_HEIGHT / 2) + 
                          (Math.random() * errorMargin - errorMargin / 2);
            
            // Calculate optimal move speed based on distance
            const distance = targetY - currentY;
            const moveSpeed = Math.min(Math.abs(distance), 5 + (this.difficulty * 3));
            
            // Move towards target with some randomness
            let newY = currentY;
            if (Math.abs(distance) > 5) {
                if (distance > 0) {
                    newY = Math.min(currentY + moveSpeed, CANVAS_HEIGHT - PADDLE_HEIGHT);
                } else {
                    newY = Math.max(currentY - moveSpeed, 0);
                }
            }
            
            // Add small random movements to make AI more human-like
            if (Math.random() < 0.1) {
                newY += (Math.random() - 0.5) * 3;
            }
            
            // Constrain to canvas bounds
            newY = Math.max(0, Math.min(CANVAS_HEIGHT - PADDLE_HEIGHT, newY));
            
            this.lastPaddlePos = JSON.stringify({ y: newY });
            return newY;
        }
        
        // If no prediction, return current position
        return currentY;
    }
}

wss.on('connection', (ws) => {
    console.log('New client connected');

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'join':
                handlePlayerJoin(ws);
                break;
            case 'paddleMove':
                broadcastToOpponent(ws, data);
                break;
            case 'gameState':
                broadcastToOpponent(ws, data);
                break;
            case 'newBrick':
            case 'destroyBrick':
                broadcastToOpponent(ws, data);
                break;
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        handlePlayerDisconnect(ws);
    });
});

function handlePlayerJoin(ws) {
    if (waitingPlayer) {
        // Replace AI with human player if one is waiting
        if (waitingPlayer.opponent instanceof AIWebSocket) {
            const ai = waitingPlayer.opponent;
            waitingPlayer.opponent = ws;
            ws.opponent = waitingPlayer;
            players.delete(ai);
        } else {
            players.add(ws);
            ws.opponent = waitingPlayer;
            waitingPlayer.opponent = ws;
        }

        console.log('Starting game with two human players');

        // Assign sides and start game
        waitingPlayer.send(JSON.stringify({
            type: 'start',
            side: 'left',
            isAI: false
        }));
        ws.send(JSON.stringify({
            type: 'start',
            side: 'right',
            isAI: false
        }));

        waitingPlayer = null;
    } else {
        // Start game with AI opponent
        waitingPlayer = ws;
        players.add(ws);
        const ai = new AIWebSocket(ws);
        players.add(ai);
        
        console.log('Starting game with AI opponent');
        
        ws.send(JSON.stringify({
            type: 'start',
            side: 'left',
            isAI: true
        }));
    }
}

function handlePlayerDisconnect(ws) {
    players.delete(ws);
    if (waitingPlayer === ws) {
        waitingPlayer = null;
    }
    if (ws.opponent) {
        if (!(ws.opponent instanceof AIWebSocket)) {
            ws.opponent.send(JSON.stringify({
                type: 'playerDisconnected'
            }));
        }
        players.delete(ws.opponent);
    }
}

function broadcastToOpponent(ws, data) {
    if (ws.opponent) {
        try {
            ws.opponent.send(JSON.stringify(data));
        } catch (error) {
            console.error('Error sending to opponent:', error);
        }
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to play`);
});