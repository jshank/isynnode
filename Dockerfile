FROM node:4.8.4-alpine
MAINTAINER Jim Shank <jim@theshanks.net>
WORKDIR /usr/src/app
ADD nodeapp /usr/src/app
RUN npm install 
EXPOSE 8881
CMD [ "npm", "start" ]
