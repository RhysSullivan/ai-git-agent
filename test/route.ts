export function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    return Response.json({
        message: `Hello!`
    });
}
