# Use an official Node.js runtime as a parent image
FROM node:18-alpine

# Install PostgreSQL client for pg_dump and psql commands
RUN apk add --no-cache postgresql-client

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm ci

# Copy the rest of the application's code
COPY . .

# The app binds to port 3001
EXPOSE 3001

# Command to run the application
CMD [ "npm", "run", "start" ]
