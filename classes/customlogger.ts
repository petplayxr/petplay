export const CustomLogger = (() => {
    let activeChannel = "default";

    const setChannel = (channel: string) => {
        activeChannel = channel;
    };

    const log = (channelOrMessage: string, ...messages: unknown[]) => {
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

    const error = (channelOrMessage: string, ...messages: unknown[]) => {
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

