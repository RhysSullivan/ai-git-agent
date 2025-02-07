export function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const dog = searchParams.get('cat');
    return Response.json({
        message: `Hello!`
    });
}
