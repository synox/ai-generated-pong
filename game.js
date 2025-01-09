const canvas = document.getElementById('pongCanvas');
const ctx = canvas.getContext('2d');

// Game objects
const INITIAL_BALL_SPEED = 4;
const MAX_BALL_SPEED = 8;
const BALL_SPEED_INCREASE = 1.05;

const ball = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    size: 10,
    dx: INITIAL_BALL_SPEED,
    dy: INITIAL_BALL_SPEED,
    speed: INITIAL_BALL_SPEED
};

const paddleHeight = 80;
const paddleWidth = 10;
const paddle1 = {
    x: 10,
    y: canvas.height / 2 - paddleHeight / 2,
    speed: 5
};

const paddle2 = {
    x: canvas.width - 20,
    y: canvas.height / 2 - paddleHeight / 2,
    speed: 5
};

// Score
let score1 = 0;
let score2 = 0;

// Key states
const keys = {
    ArrowUp: false,
    ArrowDown: false
};

// Event listeners
document.addEventListener('keydown', (e) => {
    if (e.key in keys) {
        keys[e.key] = true;
    }
});

document.addEventListener('keyup', (e) => {
    if (e.key in keys) {
        keys[e.key] = false;
    }
});

// Add these new constants at the top of the file, after the existing constants
const trailLength = 20;
const trail = [];
const glitters = [];

// Add these constants after the other constants
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Add after the other constants
const bricks = [];
const BRICK_WIDTH = 20;
const BRICK_HEIGHT = 40;
const MAX_BRICKS = 5; // Maximum number of bricks at once
const BRICK_SPAWN_CHANCE = 0.015; // Chance per frame to spawn a new brick

// Add at the top with other game state variables
const SYNC_INTERVAL = 50; // Sync every 50ms (20 times per second instead of 60)

// Add state interpolation
let lastReceivedState = null;
let stateUpdateTime = 0;

// Add to the top with other state variables
let gameStarted = false;
let playingAgainstAI = false;
let playerSide = null;
let isHost = false;
let brickId = 0;

// Add at the top with other constants
const PADDLE1_COLOR = '#ff4081'; // Pink for player 1
const PADDLE2_COLOR = '#64ffda'; // Teal for player 2

// Add at the top of the file
const ASPECT_RATIO = 2; // width = 2 * height
let canvasScale = 1;

// Update WebSocket connection to work with Glitch
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}`;
const ws = new WebSocket(wsUrl);

// Add resize handler function
function resizeCanvas() {
    const maxWidth = window.innerWidth * 0.95; // 95% of window width
    const maxHeight = window.innerHeight * 0.8; // 80% of window height
    
    // Calculate dimensions maintaining aspect ratio
    let newWidth = maxWidth;
    let newHeight = newWidth / ASPECT_RATIO;
    
    // If height is too big, scale based on height instead
    if (newHeight > maxHeight) {
        newHeight = maxHeight;
        newWidth = newHeight * ASPECT_RATIO;
    }
    
    // Update canvas style dimensions
    canvas.style.width = `${newWidth}px`;
    canvas.style.height = `${newHeight}px`;
    
    // Calculate scale factor
    canvasScale = newWidth / canvas.width;
}

// Add event listener for window resize
window.addEventListener('resize', resizeCanvas);

// Call resize initially
resizeCanvas();

// Add this function to send game state
function sendGameState() {
    if (isHost) {
        const currentState = {
            type: 'gameState',
            ball: {
                x: ball.x,
                y: ball.y,
                dx: ball.dx,
                dy: ball.dy
            },
            score: {
                player1: score1,
                player2: score2
            },
            // Only send bricks if they've changed
            bricks: bricks.map(brick => ({
                id: brick.id,
                x: brick.x,
                y: brick.y,
                color: brick.color
            }))
        };

        // Only send if state has changed significantly
        if (shouldSendState(currentState)) {
            ws.send(JSON.stringify(currentState));
        }
    }
}

// Add function to check if state should be sent
function shouldSendState(currentState) {
    if (!lastReceivedState) {
        lastReceivedState = currentState;
        return true;
    }

    // Always send if scores changed
    if (currentState.score.player1 !== lastReceivedState.score.player1 ||
        currentState.score.player2 !== lastReceivedState.score.player2) {
        lastReceivedState = currentState;
        return true;
    }

    // Send if ball moved significantly (more than 5 pixels)
    const ballMoved = Math.abs(currentState.ball.x - lastReceivedState.ball.x) > 5 ||
                     Math.abs(currentState.ball.y - lastReceivedState.ball.y) > 5;

    // Send if bricks changed
    const bricksChanged = JSON.stringify(currentState.bricks) !== JSON.stringify(lastReceivedState.bricks);

    if (ballMoved || bricksChanged) {
        lastReceivedState = currentState;
        return true;
    }

    return false;
}

// Add this new class for bricks
class Brick {
    constructor(id = null, x = null, y = null, color = null) {
        this.id = id || brickId++;
        this.width = BRICK_WIDTH;
        this.height = BRICK_HEIGHT;
        
        // Position bricks in middle third of screen height, away from top and bottom
        this.x = x || (canvas.width * 0.4 + Math.random() * (canvas.width * 0.2)); // Middle fifth of screen width
        this.y = y || (canvas.height * 0.1 + Math.random() * (canvas.height * 0.8)); // Most of screen height
        
        this.color = color || `hsl(${Math.random() * 360}, 100%, 50%)`;
    }

    draw(ctx) {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.width, this.height);
        
        // Add shine effect
        const gradient = ctx.createLinearGradient(
            this.x, this.y,
            this.x + this.width, this.y + this.height
        );
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(this.x, this.y, this.width, this.height);
    }

    checkCollision(ball) {
        if (ball.x + ball.size > this.x &&
            ball.x - ball.size < this.x + this.width &&
            ball.y + ball.size > this.y &&
            ball.y - ball.size < this.y + this.height) {
            
            // Determine if collision is more horizontal or vertical
            const dx = ball.x - (this.x + this.width/2);
            const dy = ball.y - (this.y + this.height/2);
            
            if (Math.abs(dx) > Math.abs(dy)) {
                ball.dx = -ball.dx;
            } else {
                ball.dy = -ball.dy;
            }
            
            return true;
        }
        return false;
    }
}

// Add this function to manage brick spawning
function manageBricks() {
    // Draw bricks first to ensure they're always visible
    bricks.forEach(brick => brick.draw(ctx));

    if (isHost) {
        // Spawn new bricks
        if (bricks.length < MAX_BRICKS && Math.random() < BRICK_SPAWN_CHANCE) {
            const newBrick = new Brick();
            bricks.push(newBrick);
            ws.send(JSON.stringify({
                type: 'newBrick',
                brick: {
                    id: newBrick.id,
                    x: newBrick.x,
                    y: newBrick.y,
                    color: newBrick.color
                }
            }));
        }

        // Check collisions
        for (let i = bricks.length - 1; i >= 0; i--) {
            if (bricks[i].checkCollision(ball)) {
                createGlitterBurst(
                    bricks[i].x + BRICK_WIDTH/2,
                    bricks[i].y + BRICK_HEIGHT/2,
                    40
                );
                playSound(createBrickDestroySound);
                
                const destroyedBrickId = bricks[i].id;
                bricks.splice(i, 1);
                
                ws.send(JSON.stringify({
                    type: 'destroyBrick',
                    brickId: destroyedBrickId
                }));
            }
        }
    }
}

// Add new sound for brick destruction
function createBrickDestroySound() {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + 0.2);
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.2);
}

function createPaddleHitSound() {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(500, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(300, audioContext.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.1);
}

function createWallHitSound() {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(300, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.1);
}

function createScoreSound() {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.2);
    
    gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.2);
}

// Replace the playSound function with this
function playSound(soundFunction) {
    soundFunction();
}

// Add this new class for glitter particles
class Glitter {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.size = Math.random() * 2 + 0.5; // Smaller particles (0.5-2.5 pixels)
        
        // Calculate spray direction
        const angle = Math.random() * Math.PI * 2; // Spray in all directions
        const speed = Math.random() * 3 + 1; // Slightly slower particles
        
        this.speedX = Math.cos(angle) * speed;
        this.speedY = Math.sin(angle) * speed;
        
        this.life = 1.0; // Shorter life
    }

    update() {
        this.x += this.speedX;
        this.y += this.speedY;
        this.life -= 0.01;
        return this.life > 0;
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${Math.random() * 360}, 100%, 70%)`;
        ctx.globalAlpha = this.life;
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

function drawBall() {
    // Draw ball
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.size, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${Date.now() / 10 % 360}, 100%, 50%)`;
    ctx.fill();
    ctx.closePath();

    // Add new position to trail
    trail.unshift({ x: ball.x, y: ball.y });
    if (trail.length > trailLength) {
        trail.pop();
    }
}

function drawPaddle(x, y, isLeftPaddle) {
    ctx.fillStyle = isLeftPaddle ? PADDLE1_COLOR : PADDLE2_COLOR;
    ctx.fillRect(x, y, paddleWidth, paddleHeight);
    
    // Add subtle shine effect
    const gradient = ctx.createLinearGradient(x, y, x + paddleWidth, y);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, paddleWidth, paddleHeight);
}

function drawScore() {
    ctx.font = '32px Arial';
    ctx.fillStyle = 'white';
    ctx.fillText(score1, canvas.width / 4, 50);
    ctx.fillText(score2, 3 * canvas.width / 4, 50);
}

function movePaddles() {
    if (playerSide === 'left') {
        // Left player moves paddle1
        if (keys.ArrowUp && paddle1.y > 0) {
            paddle1.y -= paddle1.speed;
            ws.send(JSON.stringify({
                type: 'paddleMove',
                y: paddle1.y,
                side: 'left'
            }));
        }
        if (keys.ArrowDown && paddle1.y < canvas.height - paddleHeight) {
            paddle1.y += paddle1.speed;
            ws.send(JSON.stringify({
                type: 'paddleMove',
                y: paddle1.y,
                side: 'left'
            }));
        }
    } else if (playerSide === 'right') {
        // Right player moves paddle2
        if (keys.ArrowUp && paddle2.y > 0) {
            paddle2.y -= paddle2.speed;
            ws.send(JSON.stringify({
                type: 'paddleMove',
                y: paddle2.y,
                side: 'right'
            }));
        }
        if (keys.ArrowDown && paddle2.y < canvas.height - paddleHeight) {
            paddle2.y += paddle2.speed;
            ws.send(JSON.stringify({
                type: 'paddleMove',
                y: paddle2.y,
                side: 'right'
            }));
        }
    }
}

function moveBall() {
    ball.x += ball.dx;
    ball.y += ball.dy;

    // Top and bottom collisions
    if (ball.y + ball.size > canvas.height || ball.y - ball.size < 0) {
        ball.dy = -ball.dy;
        playSound(createWallHitSound);
    }

    // Paddle collisions
    // Left paddle
    if (ball.x - ball.size < paddle1.x + paddleWidth &&
        ball.y > paddle1.y &&
        ball.y < paddle1.y + paddleHeight &&
        ball.dx < 0) {
        ball.dx = -ball.dx;
        increaseBallSpeed();
        createGlitterBurst(ball.x, ball.y, 15); // Fewer particles
        playSound(createPaddleHitSound);
    }
    
    // Right paddle
    if (ball.x + ball.size > paddle2.x &&
        ball.y > paddle2.y &&
        ball.y < paddle2.y + paddleHeight &&
        ball.dx > 0) {
        ball.dx = -ball.dx;
        increaseBallSpeed();
        createGlitterBurst(ball.x, ball.y, 15); // Fewer particles
        playSound(createPaddleHitSound);
    }

    // Scoring
    if (ball.x < 0) {
        playSound(createScoreSound);
        score2++;
        resetBall();
    } else if (ball.x > canvas.width) {
        playSound(createScoreSound);
        score1++;
        resetBall();
    }
}

function increaseBallSpeed() {
    const newSpeed = ball.speed * BALL_SPEED_INCREASE;
    if (newSpeed <= MAX_BALL_SPEED) {
        ball.speed = newSpeed;
        // Maintain direction while updating speed
        const direction = Math.atan2(ball.dy, ball.dx);
        ball.dx = Math.cos(direction) * ball.speed;
        ball.dy = Math.sin(direction) * ball.speed;
    }
}

function resetBall() {
    ball.x = canvas.width / 2;
    ball.y = canvas.height / 2;
    ball.speed = INITIAL_BALL_SPEED;
    
    // Set initial direction
    const angle = (Math.random() * Math.PI / 2) - Math.PI / 4; // Random angle between -45 and 45 degrees
    const direction = Math.random() > 0.5 ? angle : Math.PI + angle; // Randomly choose left or right
    
    ball.dx = Math.cos(direction) * ball.speed;
    ball.dy = Math.sin(direction) * ball.speed;
}

function gameLoop() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Update game objects
    movePaddles();
    moveBall();
    manageBricks();

    // Update and draw glitter
    for (let i = glitters.length - 1; i >= 0; i--) {
        if (!glitters[i].update()) {
            glitters.splice(i, 1);
        } else {
            glitters[i].draw(ctx);
        }
    }

    // Draw everything
    drawBall();
    drawPaddle(paddle1.x, paddle1.y, true);  // Left paddle
    drawPaddle(paddle2.x, paddle2.y, false); // Right paddle
    drawScore();

    // Continue game loop
    requestAnimationFrame(gameLoop);
}

// Add this new function for creating glitter bursts
function createGlitterBurst(x, y, count) {
    for (let i = 0; i < count; i++) {
        // Add slight offset to starting position to create wider burst
        const offsetX = (Math.random() - 0.5) * 10;
        const offsetY = (Math.random() - 0.5) * 10;
        glitters.push(new Glitter(x + offsetX, y + offsetY));
    }
}

ws.onopen = () => {
    console.log('Connected to server');
    // Join game room
    ws.send(JSON.stringify({ type: 'join' }));
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    switch (data.type) {
        case 'start':
            handleGameStart(data);
            break;
        case 'paddleMove':
            handleRemotePaddleMove(data);
            break;
        case 'gameState':
            handleRemoteGameState(data);
            break;
        case 'playerDisconnected':
            handlePlayerDisconnected();
            break;
        case 'newBrick':
            handleNewBrick(data.brick);
            break;
        case 'destroyBrick':
            handleDestroyBrick(data.brickId);
            break;
    }
};

function handleGameStart(data) {
    playerSide = data.side;
    isHost = playerSide === 'left';
    playingAgainstAI = data.isAI;
    gameStarted = true;
    
    // Show the controls and update status
    const controlsElement = document.getElementById('controls');
    const statusElement = document.querySelector('#status p:first-child'); // Get the waiting message
    
    // Hide waiting message
    statusElement.style.display = 'none';
    
    // Show controls
    controlsElement.style.display = 'block';
    controlsElement.textContent = `You are on the ${playerSide} side. Use Up/Down Arrow keys to move. ${playingAgainstAI ? '(Playing against AI)' : ''}`;
    
    // Start the game
    if (isHost) {
        sendGameState();
        setInterval(sendGameState, SYNC_INTERVAL);
    }
    
    // Initialize audio context
    audioContext.resume().catch(console.error);
    
    // Start game loop
    gameLoop();
}

function handleRemotePaddleMove(data) {
    if (data.side === 'left') {
        paddle1.y = data.y;
    } else {
        paddle2.y = data.y;
    }
}

function handleRemoteGameState(data) {
    if (!isHost) {
        const now = performance.now();
        const timeDelta = now - stateUpdateTime;
        stateUpdateTime = now;

        // Smoothly update ball position
        if (lastReceivedState) {
            const lerpFactor = Math.min(1, timeDelta / SYNC_INTERVAL);
            ball.x = lerp(ball.x, data.ball.x, lerpFactor);
            ball.y = lerp(ball.y, data.ball.y, lerpFactor);
        } else {
            ball.x = data.ball.x;
            ball.y = data.ball.y;
        }

        // Update ball velocity and speed
        ball.dx = data.ball.dx;
        ball.dy = data.ball.dy;
        ball.speed = Math.sqrt(ball.dx * ball.dx + ball.dy * ball.dy);

        // Update scores directly (no mirroring)
        score1 = data.score.player1;
        score2 = data.score.player2;
        
        // Update bricks only when they change
        if (data.bricks && JSON.stringify(bricks) !== JSON.stringify(data.bricks)) {
            bricks.length = 0;
            data.bricks.forEach(brickData => {
                bricks.push(new Brick(
                    brickData.id,
                    brickData.x,
                    brickData.y,
                    brickData.color
                ));
            });
        }

        lastReceivedState = data;
    }
}

function handlePlayerDisconnected() {
    if (!playingAgainstAI) {
        alert('Other player disconnected');
        location.reload();
    }
}

function handleNewBrick(brickData) {
    if (!isHost) {
        bricks.push(new Brick(
            brickData.id,
            brickData.x, // Use original x position
            brickData.y,
            brickData.color
        ));
    }
}

function handleDestroyBrick(brickId) {
    const index = bricks.findIndex(brick => brick.id === brickId);
    if (index !== -1) {
        // Create smaller explosion effect
        createGlitterBurst(
            bricks[index].x + BRICK_WIDTH/2,
            bricks[index].y + BRICK_HEIGHT/2,
            20 // Fewer particles for brick destruction
        );
        playSound(createBrickDestroySound);
        bricks.splice(index, 1);
    }
}

// Add helper function for linear interpolation
function lerp(start, end, t) {
    return start * (1 - t) + end * t;
} 