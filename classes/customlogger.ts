export const CustomLogger = (() => {
    let activeChannel = "syncloop";

    const setChannel = (channel) => {
        activeChannel = channel;
    };

    const log = (channelOrMessage, ...messages) => {
        if (typeof channelOrMessage === 'string' && messages.length > 0) {
            // A channel was specified
            if (channelOrMessage === activeChannel) {
                console.log(...messages);
            }
        } else {
            // No channel specified, use active channel
            if (activeChannel === "default") {
                console.log(channelOrMessage, ...messages);
            }
        }
    };

    const error = (channelOrMessage, ...messages) => {
        if (typeof channelOrMessage === 'string' && messages.length > 0) {
            // A channel was specified
            if (channelOrMessage === activeChannel) {
                console.error(...messages);
            }
        } else {
            // No channel specified, use active channel
            if (activeChannel === "default") {
                console.error(channelOrMessage, ...messages);
            }
        }
    };

    return {
        setChannel,
        log,
        error
    };
})();

