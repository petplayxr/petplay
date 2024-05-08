
const hostname = "127.0.0.1";
const port = 27015;

// Function to send data to the server
async function sendData(conn: Deno.TcpConn, data: string) {
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(data);
    await conn.write(encodedData);
    console.log("Sent data back to server.");
}

// Function to continuously receive data from the server
// Function to continuously receive data from the server and process it
async function receiveAndProcessData() {
    try {
        // Connect to the server using TCP
        const conn = await Deno.connect({
            hostname: hostname,
            port: port,
        });
        console.log("Connected to server!");

        // Read and process data continuously from the server
        const buffer = new Uint8Array(4096);
        while (true) {
            const bytesRead = await conn.read(buffer);
            if (bytesRead === null) {
                console.log("Connection closed by server.");
                break; // Exit the loop if the server closes the connection
            }
            const decoder = new TextDecoder();
            const receivedMsg = decoder.decode(buffer.subarray(0, bytesRead));
            console.log("Received data:", receivedMsg);

            // Use the sendData function to echo the data back
            await sendData(conn, receivedMsg);
        }

        // Close the connection
        conn.close();
    } catch (error) {
        console.error("Error communicating with the server:", error);
    }
}

// Start receiving data
receiveAndProcessData();