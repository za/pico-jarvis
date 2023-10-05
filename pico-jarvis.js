const fs = require('fs');
const http = require('http');

const LLAMA_API_URL = process.env.LLAMA_API_URL || 'http://127.0.0.1:8080/completion';

const OPENWEATHERMAP_API_KEY = process.env.OPENWEATHERMAP_API_KEY;

async function geocode(location) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${location}&count=1&format=json`
    const response = await fetch(url);
    const { results } = await response.json();
    return results.pop();
}

async function weather(location) {
    const { latitude, longitude } = await geocode(location);
    const url = `https://api.openweathermap.org/data/2.5/weather?units=metric&lat=${latitude}&lon=${longitude}&appid=${OPENWEATHERMAP_API_KEY}`
    const response = await fetch(url);
    const data = await response.json();
    const { name, weather, main } = data;
    const { description } = weather[0];
    const { temp, humidity } = main;
    const summary = `The current weather in ${name} is ${description} at ${temp} °C and humidity ${humidity}%`;
    return { summary, description, temp, humidity };
}

async function llama(prompt) {
    const method = 'POST';
    const headers = {
        'Content-Type': 'application/json'
    };
    const body = JSON.stringify({
        prompt: prompt,
        n_predict: 200,
        temperature: 0,
        top_k: 20,
        stop: ["Llama:", "User:"]
    });
    const request = { method, headers, body };
    const response = await fetch(LLAMA_API_URL, request);
    const data = await response.json();
    const { content } = data;
    return content.trim();
}

const SYSTEM_MESSAGE = `You run in a process of Question, Thought, Action, Observation.

Use Thought to describe your thoughts about the question you have been asked.
Observation will be the result of running those actions.

If you can not answer the question from your memory, use Action to run one of these actions available to you:

- weather: location
- lookup: terms

Finally at the end, state the Answer.

Here are some sample sessions.

Question: What is capital of france?
Thought: This is about geography, I can recall the answer from my memory.
Action: lookup: capital of France.
Observation: Paris is the capital of France.
Answer: The capital of France is Paris.

Question: How's the temperature in Berlin?
Thought: This is related to weather and I always use weather action.
Action: weather: Berlin
Observation: Cloudy at 17 degrees Celcius.
Answer: 17 degrees Celcius.

Question: Who painted Mona Lisa?
Thought: This is about general knowledge, I can recall the answer from my memory.
Action: lookup: painter of Mona Lisa.
Observation: Mona Lisa was painted by Leonardo da Vinci .
Answer: Leonardo da Vinci painted Mona Lisa.

Let's go!`;


async function act(text) {
    const MARKER = 'Action:';
    const pos = text.lastIndexOf(MARKER);
    if (pos < 0) {
        // throw new Error('Unable to find Action!');
        return null;
    }
    const subtext = text.substr(pos) + '\n';
    const matches = /Action:\s*(.*?)\n/.exec(subtext);
    const action = matches[1];
    if (!action) {
        return null;
    }

    const SEPARATOR = ':';
    const sep = action.indexOf(SEPARATOR);
    if (sep < 0) {
        // throw new Error('Invalid action!');
        // console.error('Invalid action', text);
        return null;
    }
    const name = action.substring(0, sep);
    const arg = action.substring(sep + 1).trim();

    if (name === 'lookup') {
        return null; // internal
    }

    if (name === 'weather') {
        try {
            const { summary } = await weather(arg);
            const observation = summary;
            console.log('ACT weather', { arg, observation });
            return { action, name, arg, observation };
        } catch (e) {
            console.error(e.toString());
            return null;
        }

    }
    console.error('Not recognized action', name, arg);
}

async function answer(text) {
    const MARKER = 'Answer:';
    const pos = text.lastIndexOf(MARKER);
    if (pos < 0) return "?";
    const answer = text.substr(pos + MARKER.length).trim();
    return answer;
}

async function reason(inquiry) {
    const prompt = SYSTEM_MESSAGE + '\n\n' + inquiry;
    const response = await llama(prompt);
    console.log('--');
    console.log(response);
    console.log('--');
    const result = await act(response);
    if (!result) {
        return await answer(response);
    }

    const { observation } = result;
    const second_prompt = `${inquiry}
Observation: ${observation}.
Thought: Now I have the answer.
Answer:`;
    console.log('===');
    console.log(second_prompt);
    console.log('===');
    return await llama(second_prompt);
}

async function handler(request, response) {
    const { url } = request;
    console.log(`Handling ${url}...`);
    if (url === '/health') {
        response.writeHead(200).end('OK');
    } else if (url === '/' || url === '/index.html') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(fs.readFileSync('./index.html'));
    } else if (url.startsWith('/chat')) {
        const parsedUrl = new URL(`http://localhost/${url}`);
        const { search } = parsedUrl;
        const question = decodeURIComponent(search.substring(1));
        console.log('Waiting for Llama...');
        const answer = await reason('Question: ' + question);
        console.log('LLama answers:', answer);
        response.writeHead(200).end(answer);
    } else {
        console.error(`${url} is 404!`)
        response.writeHead(404);
        response.end();
    }
}

http.createServer(handler).listen(5000);
