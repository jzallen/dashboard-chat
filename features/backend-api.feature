Feature: Cloudflare Worker Backend API
  As a frontend application
  I want to communicate with a Cloudflare Worker backend
  So that chat messages are processed by the AI and streamed back

  Background:
    Given the Cloudflare Worker is deployed and running

  Scenario: POST /chat endpoint accepts messages
    When I send a POST request to /chat with messages array
    Then the endpoint should accept the request
    And the response should be a Server-Sent Events stream

  Scenario: Backend forwards messages to AI model
    When I send a chat request
    Then the backend should include the system prompt
    And the backend should include the user messages
    And the backend should include the tool definitions
    And the backend should call the AI model API

  Scenario: Backend streams AI response to client
    When the AI model returns a streaming response
    Then the backend should forward each chunk to the client
    And the chunks should be formatted as SSE events
    And the stream should include content events
    And the stream should include tool_calls events when applicable
    And the stream should end with a done event

  Scenario: Backend handles CORS
    When a request is made from the frontend origin
    Then the backend should include appropriate CORS headers
    And preflight OPTIONS requests should be handled

  Scenario: Health check endpoint
    When I send a GET request to /health
    Then the endpoint should return a success response
    And indicate the service is running
